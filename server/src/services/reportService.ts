import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import path from "path";
import { Role } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { assertSubmissionReviewAccess } from "../utils/access.js";
import { computeMetricValues, computeOverallScore } from "../utils/score.js";

const RAW_DELIVERY_DATA_START = "[[RAW_DELIVERY_DATA_START]]";
const RAW_DELIVERY_DATA_END = "[[RAW_DELIVERY_DATA_END]]";

function stripRawDeliveryMetadata(note?: string | null) {
  if (!note) return note ?? null;
  const startIndex = note.indexOf(RAW_DELIVERY_DATA_START);
  const endIndex = note.indexOf(RAW_DELIVERY_DATA_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return note;
  }
  const before = note.slice(0, startIndex).trim();
  const after = note.slice(endIndex + RAW_DELIVERY_DATA_END.length).trim();
  const cleaned = [before, after].filter((part) => part.length > 0).join("\n\n");
  return cleaned || null;
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(digits);
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function findExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue checking other candidates.
    }
  }
  return null;
}

export async function generateSubmissionReport(submissionId: string, requesterId: string, requesterRole: Role) {
  const submission = await prisma.kpiSubmission.findUnique({
    where: { id: submissionId },
    include: {
      template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
      values: true,
      user: { select: { id: true, name: true, email: true, role: true, managerId: true } },
      goalNotes: { include: { goal: { select: { id: true, key: true, name: true } } } },
    },
  });

  if (!submission) {
    throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
  }

  assertSubmissionReviewAccess({
    requesterId,
    requesterRole,
    submissionUserId: submission.userId,
    submissionManagerId: submission.user.managerId,
  });

  const normalizedUserName =
    submission.user.name
      ?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "employee";
  const safeNameSlug = normalizedUserName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "employee";
  const fileName = `KPI-report-${safeNameSlug}.pdf`;
  const logoPath = await findExistingPath([
    path.resolve(process.cwd(), "assets", "magic-logo.png"),
    path.resolve(process.cwd(), "assets", "magic-logo.jpg"),
    path.resolve(process.cwd(), "assets", "magic-logo.jpeg"),
  ]);

  const allMetrics = submission.template.goals.flatMap((goal) => goal.metrics);
  const valueMap = computeMetricValues(allMetrics, submission.values);
  const goalNotes = new Map(submission.goalNotes.map((note) => [note.goalId, stripRawDeliveryMetadata(note.note)]));
  const scoreResult = computeOverallScore({
    goals: submission.template.goals,
    values: submission.values,
    overallFormula: submission.template.formula,
  });
  const goalScoreMap = new Map(scoreResult.goalScores.map((goal) => [goal.goalId, goal.score]));

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const margin = 48;
    const contentWidth = doc.page.width - margin * 2;
    const chunks: Buffer[] = [];

    const palette = {
      navy: "#173B7A",
      navySoft: "#DCE7F9",
      text: "#0F172A",
      muted: "#475569",
      border: "#D7DFEA",
      rowAlt: "#F8FAFD",
      white: "#FFFFFF",
      accent: "#0B5FFF",
      panel: "#F3F7FE",
    };

    const ensureSpace = (requiredHeight: number, continuationLabel?: string) => {
      const bottom = doc.page.height - margin;
      if (doc.y + requiredHeight <= bottom) return false;

      doc.addPage();
      doc.y = margin;
      doc.strokeColor(palette.border).moveTo(margin, margin - 10).lineTo(margin + contentWidth, margin - 10).stroke();
      if (continuationLabel) {
        doc.fillColor(palette.muted).font("Helvetica").fontSize(9).text(continuationLabel, margin, margin - 24);
      }
      return true;
    };

    const drawSectionHeading = (title: string, subtitle?: string) => {
      ensureSpace(52, "KPI Performance Report (continued)");
      doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(14).text(title, margin, doc.y, { width: contentWidth });
      if (subtitle) {
        doc.moveDown(0.25);
        doc.fillColor(palette.muted).font("Helvetica").fontSize(10).text(subtitle, margin, doc.y, { width: contentWidth });
      }
      doc.moveDown(0.7);
    };

    const drawSummaryField = (x: number, y: number, label: string, value: string, width: number) => {
      doc.fillColor(palette.muted).font("Helvetica").fontSize(9).text(label, x, y, { width });
      doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(10).text(value || "-", x, y + 12, {
        width,
        lineBreak: false,
        ellipsis: true,
      });
    };

    doc.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, doc.page.width, 112).fill(palette.navy);
    const rightHeaderBlockWidth = logoPath ? 138 : 0;
    doc.fillColor(palette.white).font("Helvetica-Bold").fontSize(21).text("KPI Performance Report", margin, 28);
    doc.fillColor("#E7EEFC").font("Helvetica").fontSize(10).text(submission.template.name, margin, 58, {
      width: contentWidth - rightHeaderBlockWidth - 10,
      lineBreak: false,
      ellipsis: true,
    });
    doc.fillColor("#C6D6F6").font("Helvetica").fontSize(9).text(`Generated: ${formatDateTime(new Date())}`, margin, 78);
    if (logoPath) {
      doc.image(logoPath, doc.page.width - margin - 120, 14, {
        fit: [120, 60],
        align: "right",
        valign: "center",
      });
    }

    doc.y = 132;

    const summaryY = doc.y;
    const summaryHeight = 212;
    doc.roundedRect(margin, summaryY, contentWidth, summaryHeight, 10).fillAndStroke(palette.panel, palette.border);

    doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(13).text("Submission Summary", margin + 14, summaryY + 14);
    doc.strokeColor(palette.border).moveTo(margin + 14, summaryY + 36).lineTo(margin + contentWidth - 14, summaryY + 36).stroke();

    const fieldY = summaryY + 48;
    const fieldRowGap = 40;
    const leftX = margin + 14;
    const rightX = margin + contentWidth / 2 + 8;
    const colWidth = contentWidth / 2 - 28;

    drawSummaryField(leftX, fieldY, "Employee", submission.user.name, colWidth);
    drawSummaryField(rightX, fieldY, "Role", formatEnumLabel(submission.user.role), colWidth);
    drawSummaryField(leftX, fieldY + fieldRowGap, "Email", submission.user.email, colWidth);
    drawSummaryField(rightX, fieldY + fieldRowGap, "Status", formatEnumLabel(submission.status), colWidth);
    drawSummaryField(
      leftX,
      fieldY + fieldRowGap * 2,
      "Period",
      `${formatDate(submission.periodStart)} - ${formatDate(submission.periodEnd)}`,
      colWidth
    );
    drawSummaryField(rightX, fieldY + fieldRowGap * 2, "Template", submission.template.name, colWidth);

    doc.roundedRect(margin + 14, summaryY + 170, contentWidth - 28, 34, 8).fill(palette.navySoft);
    doc.fillColor(palette.muted).font("Helvetica").fontSize(9).text("Overall KPI Score", margin + 24, summaryY + 180);
    doc.fillColor(palette.accent).font("Helvetica-Bold").fontSize(16).text(formatNumber(scoreResult.score), margin + 14, summaryY + 176, {
      width: contentWidth - 36,
      align: "right",
    });

    doc.y = summaryY + summaryHeight + 34;

    drawSectionHeading("Goal Score Summary", "Goal-wise performance snapshot for this submission.");

    const summaryColumns = {
      goal: Math.floor(contentWidth * 0.42),
      score: Math.floor(contentWidth * 0.14),
      weight: Math.floor(contentWidth * 0.12),
      note: contentWidth - Math.floor(contentWidth * 0.42) - Math.floor(contentWidth * 0.14) - Math.floor(contentWidth * 0.12),
    };

    const drawGoalSummaryHeader = () => {
      ensureSpace(26, "Goal Score Summary");
      const y = doc.y;
      doc.roundedRect(margin, y, contentWidth, 24, 4).fill("#EAF1FE");
      doc.fillColor(palette.muted).font("Helvetica-Bold").fontSize(9);
      doc.text("Goal", margin + 8, y + 7, { width: summaryColumns.goal - 10 });
      doc.text("Score", margin + summaryColumns.goal + 8, y + 7, { width: summaryColumns.score - 12, align: "right" });
      doc.text("Weight", margin + summaryColumns.goal + summaryColumns.score + 8, y + 7, {
        width: summaryColumns.weight - 12,
        align: "right",
      });
      doc.text("Note", margin + summaryColumns.goal + summaryColumns.score + summaryColumns.weight + 8, y + 7, {
        width: summaryColumns.note - 12,
      });
      doc.y = y + 24;
    };

    drawGoalSummaryHeader();

    submission.template.goals.forEach((goal, index) => {
      const goalScore = goalScoreMap.get(goal.id);
      const noteText = (goalNotes.get(goal.id) ?? "").replace(/\s+/g, " ").trim();
      const notePreview = noteText.length > 90 ? `${noteText.slice(0, 87)}...` : noteText || "-";

      const rowHeight = Math.max(
        24,
        doc.heightOfString(goal.name, { width: summaryColumns.goal - 12 }),
        doc.heightOfString(notePreview, { width: summaryColumns.note - 12 })
      ) + 10;

      const didBreak = ensureSpace(rowHeight + 1, "Goal Score Summary (continued)");
      if (didBreak) {
        drawGoalSummaryHeader();
      }

      const y = doc.y;
      if (index % 2 === 1) {
        doc.rect(margin, y, contentWidth, rowHeight).fill(palette.rowAlt);
      }

      doc.fillColor(palette.text).font("Helvetica").fontSize(10);
      doc.text(goal.name, margin + 8, y + 6, { width: summaryColumns.goal - 12 });
      doc.font("Helvetica-Bold").text(formatNumber(goalScore), margin + summaryColumns.goal + 8, y + 6, {
        width: summaryColumns.score - 12,
        align: "right",
      });
      doc.font("Helvetica").text(String(goal.weight ?? "-"), margin + summaryColumns.goal + summaryColumns.score + 8, y + 6, {
        width: summaryColumns.weight - 12,
        align: "right",
      });
      doc.text(notePreview, margin + summaryColumns.goal + summaryColumns.score + summaryColumns.weight + 8, y + 6, {
        width: summaryColumns.note - 12,
      });

      doc.strokeColor(palette.border).moveTo(margin, y + rowHeight).lineTo(margin + contentWidth, y + rowHeight).stroke();
      doc.y = y + rowHeight;
    });

    const metricColumns = {
      label: Math.floor(contentWidth * 0.52),
      category: Math.floor(contentWidth * 0.23),
      value: contentWidth - Math.floor(contentWidth * 0.52) - Math.floor(contentWidth * 0.23),
    };

    const drawMetricHeader = () => {
      ensureSpace(24, "Detailed Goal Metrics");
      const y = doc.y;
      doc.roundedRect(margin, y, contentWidth, 22, 4).fill("#EEF3FB");
      doc.fillColor(palette.muted).font("Helvetica-Bold").fontSize(9);
      doc.text("Metric", margin + 8, y + 6, { width: metricColumns.label - 10 });
      doc.text("Category", margin + metricColumns.label + 8, y + 6, { width: metricColumns.category - 10 });
      doc.text("Value", margin + metricColumns.label + metricColumns.category + 8, y + 6, {
        width: metricColumns.value - 12,
        align: "right",
      });
      doc.y = y + 22;
    };

    const totalGoals = submission.template.goals.length;

    submission.template.goals.forEach((goal, goalIndex) => {
      doc.addPage();
      doc.y = margin;
      drawSectionHeading(
        "Detailed Goal Metrics",
        `Goal ${goalIndex + 1} of ${totalGoals}`
      );

      const goalScore = goalScoreMap.get(goal.id);
      const goalNote = (goalNotes.get(goal.id) ?? "").trim();

      ensureSpace(70, "Detailed Goal Metrics");
      const headerY = doc.y;
      doc.roundedRect(margin, headerY, contentWidth, 42, 8).fillAndStroke("#F7FAFF", palette.border);
      doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(12).text(goal.name, margin + 12, headerY + 10, {
        width: contentWidth - 160,
      });
      doc.fillColor(palette.accent).font("Helvetica-Bold").fontSize(12).text(formatNumber(goalScore), margin + contentWidth - 132, headerY + 10, {
        width: 120,
        align: "right",
      });
      doc.fillColor(palette.muted).font("Helvetica").fontSize(8).text("Goal Score", margin + contentWidth - 132, headerY + 25, {
        width: 120,
        align: "right",
      });
      doc.y = headerY + 48;

      if (goal.description) {
        ensureSpace(24, `${goal.name} (continued)`);
        doc.fillColor(palette.muted).font("Helvetica").fontSize(10).text(goal.description, margin, doc.y, {
          width: contentWidth,
        });
        doc.moveDown(0.5);
      }

      if (goalNote) {
        ensureSpace(24, `${goal.name} (continued)`);
        doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(9).text("Goal Note:", margin, doc.y);
        doc.fillColor(palette.muted).font("Helvetica").fontSize(9).text(goalNote, margin + 58, doc.y - 10, {
          width: contentWidth - 58,
        });
        doc.moveDown(0.6);
      }

      drawMetricHeader();

      goal.metrics.forEach((metric, metricIndex) => {
        const metricValue = valueMap.get(metric.id);
        const category = `${metric.type}${metric.isComputed ? " (Computed)" : " (Input)"}`;
        const valueLabel = formatNumber(metricValue);
        const rowHeight =
          Math.max(
            doc.heightOfString(metric.label, { width: metricColumns.label - 12 }),
            doc.heightOfString(category, { width: metricColumns.category - 12 }),
            doc.heightOfString(valueLabel, { width: metricColumns.value - 12 })
          ) + 12;

        const didBreak = ensureSpace(rowHeight + 1, `${goal.name} (continued)`);
        if (didBreak) {
          drawMetricHeader();
        }

        const y = doc.y;
        if (metricIndex % 2 === 1) {
          doc.rect(margin, y, contentWidth, rowHeight).fill(palette.rowAlt);
        }

        doc.fillColor(palette.text).font("Helvetica").fontSize(10).text(metric.label, margin + 8, y + 6, {
          width: metricColumns.label - 12,
        });
        doc.fillColor(palette.muted).font("Helvetica").fontSize(9).text(category, margin + metricColumns.label + 8, y + 7, {
          width: metricColumns.category - 12,
        });
        doc.fillColor(palette.text).font("Helvetica-Bold").fontSize(10).text(valueLabel, margin + metricColumns.label + metricColumns.category + 8, y + 6, {
          width: metricColumns.value - 12,
          align: "right",
        });

        doc.strokeColor(palette.border).moveTo(margin, y + rowHeight).lineTo(margin + contentWidth, y + rowHeight).stroke();
        doc.y = y + rowHeight;
      });

      doc.moveDown(1);
    });

    ensureSpace(40, "KPI Performance Report");
    doc.strokeColor(palette.border).moveTo(margin, doc.y).lineTo(margin + contentWidth, doc.y).stroke();
    doc.moveDown(0.65);
    doc.fillColor(palette.muted).font("Helvetica").fontSize(8).text(
      "This report is system-generated from submitted KPI values and template formulas. For internal performance review use.",
      margin,
      doc.y,
      { width: contentWidth, align: "left" }
    );

    doc.end();
  });

  return {
    fileName,
    mimeType: "application/pdf",
    buffer,
  };
}
