import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { computeScore } from "../utils/score.js";
export async function createSubmission(userId, input) {
    if (input.periodStart > input.periodEnd) {
        throw new AppError("Period start must be before period end", 400, "PERIOD_INVALID");
    }
    const template = await prisma.kpiTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
        include: { metrics: true },
    });
    if (!template) {
        throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
    }
    const valuesByMetric = new Map(input.values.map((value) => [value.metricId, value]));
    if (valuesByMetric.size !== input.values.length) {
        throw new AppError("Duplicate metric values provided", 400, "DUPLICATE_METRIC");
    }
    const metricIds = new Set(template.metrics.map((metric) => metric.id));
    for (const value of input.values) {
        if (!metricIds.has(value.metricId)) {
            throw new AppError("Metric does not belong to template", 400, "METRIC_INVALID");
        }
    }
    const score = computeScore({
        formula: template.formula,
        metrics: template.metrics,
        values: input.values.map((value) => ({
            metricId: value.metricId,
            valueNumber: value.valueNumber,
        })),
    });
    return prisma.$transaction(async (tx) => {
        const submission = await tx.kpiSubmission.create({
            data: {
                userId,
                templateId: template.id,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
                status: "SUBMITTED",
                score,
            },
        });
        const valueRows = template.metrics.flatMap((metric) => {
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
        return tx.kpiSubmission.findUnique({
            where: { id: submission.id },
            include: {
                template: { include: { metrics: { orderBy: { order: "asc" } } } },
                values: true,
            },
        });
    });
}
export async function listMySubmissions(userId) {
    return prisma.kpiSubmission.findMany({
        where: { userId },
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { metrics: { orderBy: { order: "asc" } } } },
            values: true,
        },
    });
}
export async function listTeamSubmissions(managerId) {
    const reports = await prisma.user.findMany({
        where: { managerId },
        select: { id: true },
    });
    const reportIds = reports.map((report) => report.id);
    if (reportIds.length === 0) {
        return [];
    }
    return prisma.kpiSubmission.findMany({
        where: { userId: { in: reportIds } },
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { metrics: { orderBy: { order: "asc" } } } },
            values: true,
            user: { select: { id: true, name: true, email: true, role: true } },
        },
    });
}
export async function listAllSubmissions() {
    return prisma.kpiSubmission.findMany({
        orderBy: { periodEnd: "desc" },
        include: {
            template: { include: { metrics: { orderBy: { order: "asc" } } } },
            values: true,
            user: { select: { id: true, name: true, email: true, role: true } },
        },
    });
}
export async function getSubmissionDetails(id) {
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id },
        include: {
            template: { include: { metrics: { orderBy: { order: "asc" } } } },
            values: true,
            user: { select: { id: true, name: true, email: true, role: true, managerId: true } },
            reviews: {
                orderBy: { reviewedAt: "desc" },
                include: { reviewer: { select: { id: true, name: true, role: true } } },
            },
            comments: {
                orderBy: { createdAt: "asc" },
                include: { author: { select: { id: true, name: true, role: true } } },
            },
            reports: true,
        },
    });
    if (!submission) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    return submission;
}
