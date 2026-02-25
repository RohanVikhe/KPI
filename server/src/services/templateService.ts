import { MetricType, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";

type MetricInput = {
  key: string;
  label: string;
  type: MetricType;
  isComputed?: boolean;
  definition?: string | null;
  formulaText?: string | null;
  calcFormula?: string | null;
  targetText?: string | null;
  frequency?: string | null;
  required?: boolean;
  min?: number | null;
  max?: number | null;
  weight?: number | null;
  order?: number | null;
};

type GoalInput = {
  key: string;
  name: string;
  description?: string | null;
  formula?: string | null;
  weight?: number | null;
  order?: number | null;
  metrics: MetricInput[];
};

type TemplateInput = {
  name: string;
  description?: string | null;
  formula?: string | null;
  isActive?: boolean;
  goals: GoalInput[];
};

function assertUniqueMetricKeys(goals: GoalInput[]) {
  const keys = goals.flatMap((goal) => goal.metrics.map((metric) => metric.key));
  const keySet = new Set(keys);
  if (keys.length !== keySet.size) {
    throw new AppError("Metric keys must be unique", 400, "DUPLICATE_METRIC_KEY");
  }
}

function assertUniqueGoalKeys(goals: GoalInput[]) {
  const keys = goals.map((goal) => goal.key);
  const keySet = new Set(keys);
  if (keys.length !== keySet.size) {
    throw new AppError("Goal keys must be unique", 400, "DUPLICATE_GOAL_KEY");
  }
}

export async function listTemplates() {
  return prisma.kpiTemplate.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      goals: {
        orderBy: { order: "asc" },
        include: { metrics: { orderBy: { order: "asc" } } },
      },
    },
  });
}

export async function getTemplate(id: string) {
  const template = await prisma.kpiTemplate.findUnique({
    where: { id },
    include: {
      goals: {
        orderBy: { order: "asc" },
        include: { metrics: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!template) {
    throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
  }

  return template;
}

export async function createTemplate(input: TemplateInput, createdById: string) {
  assertUniqueGoalKeys(input.goals);
  assertUniqueMetricKeys(input.goals);

  return prisma.$transaction(async (tx) => {
    const template = await tx.kpiTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        formula: input.formula ?? null,
        isActive: input.isActive ?? true,
        createdById,
      },
    });

    const createdGoals = await Promise.all(
      input.goals.map((goal, index) =>
        tx.kpiGoal.create({
          data: {
            templateId: template.id,
            key: goal.key,
            name: goal.name,
            description: goal.description ?? null,
            formula: goal.formula ?? null,
            weight: goal.weight ?? null,
            order: goal.order ?? index,
          },
        })
      )
    );

    const metricsData: Prisma.KpiMetricCreateManyInput[] = createdGoals.flatMap((goal, goalIndex) => {
      const metrics = input.goals[goalIndex].metrics;
      return metrics.map((metric, metricIndex) => ({
        templateId: template.id,
        goalId: goal.id,
        key: metric.key,
        label: metric.label,
        type: metric.type,
        isComputed: metric.isComputed ?? false,
        definition: metric.definition ?? null,
        formulaText: metric.formulaText ?? null,
        calcFormula: metric.calcFormula ?? null,
        targetText: metric.targetText ?? null,
        frequency: metric.frequency ?? null,
        required: metric.required ?? true,
        min: metric.min ?? null,
        max: metric.max ?? null,
        weight: metric.weight ?? null,
        order: metric.order ?? metricIndex,
      }));
    });

    if (metricsData.length > 0) {
      await tx.kpiMetric.createMany({ data: metricsData });
    }

    const fullTemplate = await tx.kpiTemplate.findUnique({
      where: { id: template.id },
      include: {
        goals: {
          orderBy: { order: "asc" },
          include: { metrics: { orderBy: { order: "asc" } } },
        },
      },
    });

    if (!fullTemplate) {
      throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
    }

    return fullTemplate;
  });
}

export async function updateTemplate(id: string, input: Partial<TemplateInput>) {
  if (input.goals) {
    assertUniqueGoalKeys(input.goals);
    assertUniqueMetricKeys(input.goals);
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

    if (input.goals) {
      await tx.kpiMetric.deleteMany({ where: { templateId: template.id } });
      await tx.kpiGoal.deleteMany({ where: { templateId: template.id } });

      const createdGoals = await Promise.all(
        input.goals.map((goal, index) =>
          tx.kpiGoal.create({
            data: {
              templateId: template.id,
              key: goal.key,
              name: goal.name,
              description: goal.description ?? null,
              formula: goal.formula ?? null,
              weight: goal.weight ?? null,
              order: goal.order ?? index,
            },
          })
        )
      );

      const metricsData: Prisma.KpiMetricCreateManyInput[] = createdGoals.flatMap((goal, goalIndex) => {
        const metrics = input.goals?.[goalIndex]?.metrics ?? [];
        return metrics.map((metric, metricIndex) => ({
          templateId: template.id,
          goalId: goal.id,
          key: metric.key,
          label: metric.label,
          type: metric.type,
          isComputed: metric.isComputed ?? false,
          definition: metric.definition ?? null,
          formulaText: metric.formulaText ?? null,
          calcFormula: metric.calcFormula ?? null,
          targetText: metric.targetText ?? null,
          frequency: metric.frequency ?? null,
          required: metric.required ?? true,
          min: metric.min ?? null,
          max: metric.max ?? null,
          weight: metric.weight ?? null,
          order: metric.order ?? metricIndex,
        }));
      });

      if (metricsData.length > 0) {
        await tx.kpiMetric.createMany({ data: metricsData });
      }
    }

    return tx.kpiTemplate.findUnique({
      where: { id: template.id },
      include: {
        goals: {
          orderBy: { order: "asc" },
          include: { metrics: { orderBy: { order: "asc" } } },
        },
      },
    });
  });
}

export async function deleteTemplate(id: string) {
  const template = await prisma.kpiTemplate.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!template) {
    throw new AppError("Template not found", 404, "TEMPLATE_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    const submissions = await tx.kpiSubmission.findMany({
      where: { templateId: id },
      select: { id: true },
    });
    const submissionIds = submissions.map((submission) => submission.id);

    if (submissionIds.length > 0) {
      await tx.kpiValue.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.kpiReview.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.kpiComment.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.kpiGoalNote.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.kpiSubmission.deleteMany({ where: { id: { in: submissionIds } } });
    }

    await tx.kpiMetric.deleteMany({ where: { templateId: id } });
    await tx.kpiGoal.deleteMany({ where: { templateId: id } });
    await tx.kpiTemplate.delete({ where: { id } });
  });

  return { id };
}
