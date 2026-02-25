import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
function assertUniqueKeys(metrics) {
    const keys = metrics.map((metric) => metric.key);
    const keySet = new Set(keys);
    if (keys.length !== keySet.size) {
        throw new AppError("Metric keys must be unique", 400, "DUPLICATE_METRIC_KEY");
    }
}
export async function listTemplates() {
    return prisma.kpiTemplate.findMany({
        orderBy: { createdAt: "desc" },
        include: { metrics: { orderBy: { order: "asc" } } },
    });
}
export async function getTemplate(id) {
    const template = await prisma.kpiTemplate.findUnique({
        where: { id },
        include: { metrics: { orderBy: { order: "asc" } } },
    });
    if (!template) {
        throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
    }
    return template;
}
export async function createTemplate(input, createdById) {
    assertUniqueKeys(input.metrics);
    const metricsData = input.metrics.map((metric, index) => ({
        key: metric.key,
        label: metric.label,
        type: metric.type,
        required: metric.required ?? true,
        min: metric.min ?? null,
        max: metric.max ?? null,
        weight: metric.weight ?? null,
        order: metric.order ?? index,
    }));
    const template = await prisma.kpiTemplate.create({
        data: {
            name: input.name,
            description: input.description ?? null,
            formula: input.formula ?? null,
            isActive: input.isActive ?? true,
            createdById,
            metrics: {
                createMany: {
                    data: metricsData,
                },
            },
        },
        include: { metrics: { orderBy: { order: "asc" } } },
    });
    return template;
}
export async function updateTemplate(id, input) {
    if (input.metrics) {
        assertUniqueKeys(input.metrics);
    }
    return prisma.$transaction(async (tx) => {
        const template = await tx.kpiTemplate.update({
            where: { id },
            data: {
                name: input.name,
                description: input.description === undefined ? undefined : input.description,
                formula: input.formula === undefined ? undefined : input.formula,
                isActive: input.isActive === undefined ? undefined : input.isActive,
            },
        });
        if (input.metrics) {
            await tx.kpiMetric.deleteMany({ where: { templateId: template.id } });
            const metricsData = input.metrics.map((metric, index) => ({
                templateId: template.id,
                key: metric.key,
                label: metric.label,
                type: metric.type,
                required: metric.required ?? true,
                min: metric.min ?? null,
                max: metric.max ?? null,
                weight: metric.weight ?? null,
                order: metric.order ?? index,
            }));
            await tx.kpiMetric.createMany({ data: metricsData });
        }
        return tx.kpiTemplate.findUnique({
            where: { id: template.id },
            include: { metrics: { orderBy: { order: "asc" } } },
        });
    });
}
