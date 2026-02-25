import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { assertSubmissionAccess, assertSubmissionReviewAccess } from "../utils/access.js";
export async function generateSubmissionReport(submissionId, requesterId, requesterRole) {
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id: submissionId },
        include: {
            template: { include: { metrics: { orderBy: { order: "asc" } } } },
            values: true,
            user: { select: { id: true, name: true, email: true, role: true, managerId: true } },
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
    const reportsDir = path.resolve(env.REPORTS_DIR);
    await fs.mkdir(reportsDir, { recursive: true });
    const fileName = `kpi-report-${submission.id}-${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, fileName);
    await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 48 });
        const stream = createWriteStream(filePath);
        stream.on("finish", () => resolve());
        stream.on("error", reject);
        doc.pipe(stream);
        doc.fontSize(20).text("KPI Performance Report", { align: "left" });
        doc.moveDown();
        doc.fontSize(12).text(`Employee: ${submission.user.name} (${submission.user.email})`);
        doc.text(`Role: ${submission.user.role}`);
        doc.text(`Template: ${submission.template.name}`);
        doc.text(`Period: ${submission.periodStart.toDateString()} - ${submission.periodEnd.toDateString()}`);
        doc.text(`Status: ${submission.status}`);
        doc.text(`Score: ${submission.score ?? "N/A"}`);
        doc.moveDown();
        doc.fontSize(14).text("Metric Values");
        doc.moveDown(0.5);
        const valueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
        submission.template.metrics.forEach((metric) => {
            const value = valueMap.get(metric.id);
            doc.fontSize(12).text(`${metric.label}: ${value ?? "N/A"}`);
        });
        doc.end();
    });
    return prisma.kpiReport.create({
        data: {
            submissionId: submission.id,
            generatedById: requesterId,
            filePath,
            fileName,
            mimeType: "application/pdf",
        },
    });
}
export async function listReports(submissionId, requesterId, requesterRole) {
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id: submissionId },
        include: { user: { select: { id: true, managerId: true } } },
    });
    if (!submission) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    assertSubmissionAccess({
        requesterId,
        requesterRole,
        submissionUserId: submission.userId,
        submissionManagerId: submission.user.managerId,
    });
    return prisma.kpiReport.findMany({
        where: { submissionId },
        orderBy: { createdAt: "desc" },
    });
}
export async function getReportForDownload(reportId, requesterId, requesterRole) {
    const report = await prisma.kpiReport.findUnique({
        where: { id: reportId },
        include: { submission: { include: { user: { select: { id: true, managerId: true } } } } },
    });
    if (!report) {
        throw new AppError("Report not found", 404, "REPORT_NOT_FOUND");
    }
    assertSubmissionAccess({
        requesterId,
        requesterRole,
        submissionUserId: report.submission.userId,
        submissionManagerId: report.submission.user.managerId,
    });
    return report;
}
