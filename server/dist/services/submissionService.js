import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { normalizeSubmissionTemplateLabels } from "../utils/labels.js";
import { computeOverallScore } from "../utils/score.js";
const RAW_DELIVERY_DATA_START = "[[RAW_DELIVERY_DATA_START]]";
const RAW_DELIVERY_DATA_END = "[[RAW_DELIVERY_DATA_END]]";
const RAW_DELIVERY_GOAL_KEY = "delivery_excellence";
const RAW_MAX_HEADERS = 30;
const RAW_MAX_ROWS = 120;
const RAW_MAX_CELL_LENGTH = 500;
const RAW_MAX_LINK_LENGTH = 1000;
function toIsoDateOnly(value) {
    return value.toISOString().slice(0, 10);
}
function normalizeRawDeliveryData(input) {
    if (!input || !Array.isArray(input.headers) || !Array.isArray(input.rows)) {
        return null;
    }
    const headers = input.headers
        .map((header) => String(header ?? "").trim())
        .filter((header) => header.length > 0)
        .slice(0, RAW_MAX_HEADERS);
    if (headers.length === 0) {
        return null;
    }
    const linksInput = Array.isArray(input.links) ? input.links : [];
    const rows = [];
    const links = [];
    let hasAnyLinks = false;
    input.rows.slice(0, RAW_MAX_ROWS).forEach((row, rowIndex) => {
        const sourceRow = Array.isArray(row) ? row : [];
        const sourceLinks = Array.isArray(linksInput[rowIndex]) ? linksInput[rowIndex] : [];
        const normalizedRow = headers.map((_header, index) => String(sourceRow[index] ?? "")
            .trim()
            .slice(0, RAW_MAX_CELL_LENGTH));
        const normalizedLinks = headers.map((_header, index) => {
            const rawLink = String(sourceLinks[index] ?? "")
                .trim()
                .slice(0, RAW_MAX_LINK_LENGTH);
            if (!rawLink || rawLink.startsWith("#")) {
                return null;
            }
            return rawLink;
        });
        const hasRowData = normalizedRow.some((cell, index) => (index === 0 ? false : cell.length > 0 || Boolean(normalizedLinks[index])));
        if (!hasRowData) {
            return;
        }
        if (normalizedLinks.some((link) => Boolean(link))) {
            hasAnyLinks = true;
        }
        rows.push(normalizedRow);
        links.push(normalizedLinks);
    });
    if (rows.length === 0) {
        return null;
    }
    const sheetName = input.sheetName ? String(input.sheetName).trim().slice(0, 80) : undefined;
    return hasAnyLinks ? { sheetName, headers, rows, links } : { sheetName, headers, rows };
}
function buildRawDeliveryMetadata(rawDeliveryData) {
    return `${RAW_DELIVERY_DATA_START}\n${JSON.stringify(rawDeliveryData)}\n${RAW_DELIVERY_DATA_END}`;
}
function splitRawDeliveryMetadata(note) {
    if (!note) {
        return { cleanedNote: note ?? null, rawDeliveryData: null };
    }
    const startIndex = note.indexOf(RAW_DELIVERY_DATA_START);
    const endIndex = note.indexOf(RAW_DELIVERY_DATA_END);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        return { cleanedNote: note, rawDeliveryData: null };
    }
    const jsonStart = startIndex + RAW_DELIVERY_DATA_START.length;
    const rawJson = note.slice(jsonStart, endIndex).trim();
    let rawDeliveryData = null;
    try {
        rawDeliveryData = normalizeRawDeliveryData(JSON.parse(rawJson));
    }
    catch {
        rawDeliveryData = null;
    }
    const before = note.slice(0, startIndex).trim();
    const after = note.slice(endIndex + RAW_DELIVERY_DATA_END.length).trim();
    const cleanedNote = [before, after].filter((part) => part.length > 0).join("\n\n");
    return {
        cleanedNote: cleanedNote.length > 0 ? cleanedNote : null,
        rawDeliveryData,
    };
}
function extractRawDeliveryDataFromGoalNotes(goalNotes) {
    if (!goalNotes || goalNotes.length === 0) {
        return { goalNotes, rawDeliveryData: null };
    }
    let rawDeliveryData = null;
    const sanitizedGoalNotes = goalNotes.map((goalNote) => {
        const { cleanedNote, rawDeliveryData: extractedRawData } = splitRawDeliveryMetadata(goalNote.note);
        if (!rawDeliveryData && extractedRawData) {
            rawDeliveryData = extractedRawData;
        }
        return { ...goalNote, note: cleanedNote };
    });
    return { goalNotes: sanitizedGoalNotes, rawDeliveryData };
}
function mergeRawDeliveryDataIntoGoalNotes(goalNotes, goals, rawDeliveryData) {
    if (!rawDeliveryData) {
        return goalNotes;
    }
    const deliveryGoal = goals.find((goal) => goal.key === RAW_DELIVERY_GOAL_KEY);
    if (!deliveryGoal) {
        return goalNotes;
    }
    const metadata = buildRawDeliveryMetadata(rawDeliveryData);
    const nextGoalNotes = [...goalNotes];
    const noteIndex = nextGoalNotes.findIndex((goalNote) => goalNote.goalId === deliveryGoal.id);
    if (noteIndex === -1) {
        nextGoalNotes.push({ goalId: deliveryGoal.id, note: metadata });
        return nextGoalNotes;
    }
    const existingNote = (nextGoalNotes[noteIndex].note ?? "").trim();
    nextGoalNotes[noteIndex] = {
        ...nextGoalNotes[noteIndex],
        note: existingNote.length > 0 ? `${existingNote}\n\n${metadata}` : metadata,
    };
    return nextGoalNotes;
}
function attachGoalScores(submission) {
    const goals = submission.template?.goals ?? [];
    const { goalScores } = computeOverallScore({
        goals,
        values: submission.values,
        overallFormula: submission.template?.formula ?? null,
        strict: false,
    });
    const { goalNotes, rawDeliveryData } = extractRawDeliveryDataFromGoalNotes(submission.goalNotes);
    const withSanitizedNotes = goalNotes && goalNotes !== submission.goalNotes
        ? { ...submission, goalNotes }
        : submission;
    const normalizedSubmission = normalizeSubmissionTemplateLabels(withSanitizedNotes);
    return { ...normalizedSubmission, goalScores, rawDeliveryData };
}
export async function createSubmission(userId, input) {
    if (input.periodStart > input.periodEnd) {
        throw new AppError("Period start must be before period end", 400, "PERIOD_INVALID");
    }
    const overlappingSubmission = await prisma.kpiSubmission.findFirst({
        where: {
            userId,
            status: { not: "REJECTED" },
            periodStart: { lte: input.periodEnd },
            periodEnd: { gte: input.periodStart },
        },
        select: {
            periodStart: true,
            periodEnd: true,
        },
        orderBy: { periodStart: "desc" },
    });
    if (overlappingSubmission) {
        throw new AppError(`KPI period overlaps with an existing entry (${toIsoDateOnly(overlappingSubmission.periodStart)} to ${toIsoDateOnly(overlappingSubmission.periodEnd)}). Please choose a non-overlapping period.`, 409, "PERIOD_OVERLAP");
    }
    const template = await prisma.kpiTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
        include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } },
    });
    if (!template) {
        throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
    }
    const templateMetrics = template.goals.flatMap((goal) => goal.metrics);
    const computedMetricIds = new Set(templateMetrics.filter((metric) => metric.isComputed).map((metric) => metric.id));
    const filteredValues = input.values.filter((value) => !computedMetricIds.has(value.metricId));
    const valuesByMetric = new Map(filteredValues.map((value) => [value.metricId, value]));
    if (valuesByMetric.size !== filteredValues.length) {
        throw new AppError("Duplicate metric values provided", 400, "DUPLICATE_METRIC");
    }
    const metricIds = new Set(templateMetrics.map((metric) => metric.id));
    for (const value of filteredValues) {
        if (!metricIds.has(value.metricId)) {
            throw new AppError("Metric does not belong to template", 400, "METRIC_INVALID");
        }
    }
    const { score: computedScore } = computeOverallScore({
        goals: template.goals,
        values: filteredValues.map((value) => ({
            metricId: value.metricId,
            valueNumber: value.valueNumber,
        })),
        overallFormula: template.formula,
    });
    const normalizedRawDeliveryData = normalizeRawDeliveryData(input.rawDeliveryData);
    const goalNoteInputs = mergeRawDeliveryDataIntoGoalNotes(input.goalNotes ?? [], template.goals.map((goal) => ({ id: goal.id, key: goal.key })), normalizedRawDeliveryData);
    if (goalNoteInputs.length > 0) {
        const goalIds = new Set(template.goals.map((goal) => goal.id));
        const providedGoalIds = new Set();
        for (const note of goalNoteInputs) {
            if (!goalIds.has(note.goalId)) {
                throw new AppError("Goal does not belong to template", 400, "GOAL_INVALID");
            }
            if (providedGoalIds.has(note.goalId)) {
                throw new AppError("Duplicate goal notes provided", 400, "DUPLICATE_GOAL_NOTE");
            }
            providedGoalIds.add(note.goalId);
        }
    }
    return prisma.$transaction(async (tx) => {
        const submission = await tx.kpiSubmission.create({
            data: {
                userId,
                templateId: template.id,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
                status: "SUBMITTED",
                score: computedScore,
            },
        });
        const valueRows = templateMetrics.flatMap((metric) => {
            const value = valuesByMetric.get(metric.id);
            if (!value) {
                return [];
            }
            return [
                {
                    submissionId: submission.id,
                    metricId: metric.id,
                    valueNumber: value.valueNumber,
                    valueText: value.valueText ?? null,
                },
            ];
        });
        if (valueRows.length > 0) {
            await tx.kpiValue.createMany({ data: valueRows });
        }
        if (goalNoteInputs.length > 0) {
            await tx.kpiGoalNote.createMany({
                data: goalNoteInputs
                    .filter((note) => note.note && note.note.trim().length > 0)
                    .map((note) => ({
                    submissionId: submission.id,
                    goalId: note.goalId,
                    note: note.note ?? null,
                })),
            });
        }
        const fullSubmission = await tx.kpiSubmission.findUnique({
            where: { id: submission.id },
            include: {
                template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
                values: true,
                goalNotes: {
                    include: { goal: { select: { id: true, key: true, name: true } } },
                    orderBy: { createdAt: "asc" },
                },
            },
        });
        if (!fullSubmission) {
            throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
        }
        return attachGoalScores(fullSubmission);
    });
}
export async function listMySubmissions(userId, options) {
    const where = options?.approvedOnly
        ? { userId, status: "APPROVED" }
        : { userId };
    const submissions = await prisma.kpiSubmission.findMany({
        where,
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
            values: true,
            goalNotes: {
                include: { goal: { select: { id: true, key: true, name: true } } },
                orderBy: { createdAt: "asc" },
            },
        },
    });
    return submissions.map((submission) => attachGoalScores(submission));
}
export async function listTeamSubmissions(managerId) {
    const reports = await prisma.user.findMany({
        where: { managerId, isActive: true },
        select: { id: true },
    });
    const reportIds = reports.map((report) => report.id);
    if (reportIds.length === 0) {
        return [];
    }
    const submissions = await prisma.kpiSubmission.findMany({
        where: { userId: { in: reportIds } },
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
            values: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    projects: {
                        where: { isActive: true },
                        select: { id: true, name: true, description: true, isActive: true },
                        orderBy: { updatedAt: "desc" },
                    },
                },
            },
        },
    });
    return submissions.map((submission) => attachGoalScores(submission));
}
export async function listAllSubmissions() {
    const submissions = await prisma.kpiSubmission.findMany({
        where: { user: { isActive: true } },
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
            values: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    projects: {
                        where: { isActive: true },
                        select: { id: true, name: true, description: true, isActive: true },
                        orderBy: { updatedAt: "desc" },
                    },
                },
            },
        },
    });
    return submissions.map((submission) => attachGoalScores(submission));
}
export async function getSubmissionDetails(id) {
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id },
        include: {
            template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
            values: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    managerId: true,
                    projects: {
                        where: { isActive: true },
                        select: { id: true, name: true, description: true, isActive: true },
                        orderBy: { updatedAt: "desc" },
                    },
                },
            },
            reviews: {
                orderBy: { reviewedAt: "desc" },
                include: { reviewer: { select: { id: true, name: true, role: true } } },
            },
            comments: {
                orderBy: { createdAt: "asc" },
                include: { author: { select: { id: true, name: true, role: true } } },
            },
            goalNotes: {
                include: { goal: { select: { id: true, key: true, name: true } } },
                orderBy: { createdAt: "asc" },
            },
        },
    });
    if (!submission) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    return attachGoalScores(submission);
}
