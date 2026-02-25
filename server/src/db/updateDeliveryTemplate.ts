import { MetricType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { defaultTemplate } from "./seedDefaultTemplate.js";

const TEMPLATE_NAME = "Delivery Department KPI";
const PRUNE = process.argv.includes("--prune");

type GoalDef = (typeof defaultTemplate.goals)[number];
type MetricDef = GoalDef["metrics"][number];

async function main() {
  const templates = await prisma.kpiTemplate.findMany({
    where: { name: TEMPLATE_NAME },
    include: { goals: { include: { metrics: true } }, metrics: true },
  });

  if (templates.length === 0) {
    console.error(`Template "${TEMPLATE_NAME}" not found.`);
    process.exitCode = 1;
    return;
  }

  if (templates.length > 1) {
    console.error(
      `Multiple templates named "${TEMPLATE_NAME}" found. Resolve duplicates before running this script.`
    );
    templates.forEach((template) => {
      console.error(`- ${template.id}`);
    });
    process.exitCode = 1;
    return;
  }

  const template = templates[0];
  const desiredGoalKeys = new Set(defaultTemplate.goals.map((goal) => goal.key));
  const desiredMetricKeys = new Set(
    defaultTemplate.goals.flatMap((goal) => goal.metrics.map((metric) => metric.key))
  );

  await prisma.$transaction(async (tx) => {
    await tx.kpiTemplate.update({
      where: { id: template.id },
      data: {
        name: defaultTemplate.name,
        description: defaultTemplate.description,
        formula: defaultTemplate.formula,
        isActive: true,
      },
    });

    const existingGoals = new Map(template.goals.map((goal) => [goal.key, goal]));
    const existingMetrics = new Map(template.metrics.map((metric) => [metric.key, metric]));
    const goalIdByKey = new Map<string, string>();

    for (const [goalIndex, goal] of defaultTemplate.goals.entries()) {
      const existingGoal = existingGoals.get(goal.key);
      if (existingGoal) {
        await tx.kpiGoal.update({
          where: { id: existingGoal.id },
          data: {
            name: goal.name,
            description: goal.description ?? null,
            formula: goal.formula ?? null,
            weight: goal.weight ?? null,
            order: goalIndex,
          },
        });
        goalIdByKey.set(goal.key, existingGoal.id);
      } else {
        const created = await tx.kpiGoal.create({
          data: {
            templateId: template.id,
            key: goal.key,
            name: goal.name,
            description: goal.description ?? null,
            formula: goal.formula ?? null,
            weight: goal.weight ?? null,
            order: goalIndex,
          },
        });
        goalIdByKey.set(goal.key, created.id);
      }
    }

    for (const [goalIndex, goal] of defaultTemplate.goals.entries()) {
      const goalId = goalIdByKey.get(goal.key);
      if (!goalId) continue;
      for (const [metricIndex, metric] of goal.metrics.entries()) {
        const existingMetric = existingMetrics.get(metric.key);
        const metricData = {
          templateId: template.id,
          goalId,
          key: metric.key,
          label: metric.label,
          type: metric.type as MetricType,
          isComputed: metric.isComputed ?? false,
          definition: metric.definition ?? null,
          formulaText: metric.formulaText ?? null,
          calcFormula: metric.calcFormula ?? null,
          targetText: metric.targetText ?? null,
          frequency: metric.frequency ?? null,
          required: metric.required,
          min: metric.min ?? null,
          max: metric.max ?? null,
          weight: metric.weight ?? null,
          order: metricIndex,
        };
        if (existingMetric) {
          await tx.kpiMetric.update({
            where: { id: existingMetric.id },
            data: metricData,
          });
        } else {
          await tx.kpiMetric.create({ data: metricData });
        }
      }
    }

    if (PRUNE) {
      const metricsToDelete = template.metrics.filter((metric) => !desiredMetricKeys.has(metric.key));
      if (metricsToDelete.length > 0) {
        const metricIds = metricsToDelete.map((metric) => metric.id);
        await tx.kpiValue.deleteMany({ where: { metricId: { in: metricIds } } });
        await tx.kpiMetric.deleteMany({ where: { id: { in: metricIds } } });
      }

      const goalsToDelete = template.goals.filter((goal) => !desiredGoalKeys.has(goal.key));
      if (goalsToDelete.length > 0) {
        const goalIds = goalsToDelete.map((goal) => goal.id);
        const orphanMetrics = await tx.kpiMetric.findMany({ where: { goalId: { in: goalIds } } });
        if (orphanMetrics.length > 0) {
          const orphanMetricIds = orphanMetrics.map((metric) => metric.id);
          await tx.kpiValue.deleteMany({ where: { metricId: { in: orphanMetricIds } } });
          await tx.kpiMetric.deleteMany({ where: { id: { in: orphanMetricIds } } });
        }
        await tx.kpiGoal.deleteMany({ where: { id: { in: goalIds } } });
      }
    }
  });

  console.log(
    `Updated template "${TEMPLATE_NAME}" (${template.id}). ` +
      (PRUNE ? "Pruned metrics/goals not in PPT." : "No pruning performed.")
  );
}

main()
  .catch((error) => {
    console.error("Failed to update Delivery Department KPI template.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
