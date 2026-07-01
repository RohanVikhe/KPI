import { MetricType, Role } from "@prisma/client";
import { prisma } from "./prisma.js";

type DefaultMetricDef = {
  key: string;
  label: string;
  type: MetricType;
  required: boolean;
  min?: number | null;
  max?: number | null;
  isComputed?: boolean;
  definition?: string | null;
  formulaText?: string | null;
  calcFormula?: string | null;
  targetText?: string | null;
  frequency?: string | null;
  weight?: number | null;
};

type DefaultGoalDef = {
  key: string;
  name: string;
  description?: string | null;
  weight?: number | null;
  formula?: string | null;
  metrics: DefaultMetricDef[];
};

type DefaultTemplateDef = {
  name: string;
  description?: string | null;
  formula?: string | null;
  isActive: boolean;
  goals: DefaultGoalDef[];
};

export const defaultTemplate: DefaultTemplateDef = {
  name: "Delivery Department KPI",
  description: "Delivery Department KPI framework aligned to the 2026 delivery goals.",
  formula: "(delivery_excellence + quality_process + value_client) / 3",
  isActive: true,
  goals: [
    {
      key: "delivery_excellence",
      name: "Delivery Excellence",
      description: "Ensure projects are delivered on time, within budget, and with high quality.",
      weight: 1,
      formula:
        "(on_time_delivery + scope_change_control + first_time_right + schedule_adherence + escalation_rate + post_delivery_defect_rate) / 6",
      metrics: [
        {
          key: "de_projects_on_time_budget",
          label: "Projects Delivered On Time & Budget (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_total_projects_delivered",
          label: "Total Projects Delivered (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "de_approved_scope_changes",
          label: "Approved Scope Changes (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_total_scope_requests",
          label: "Total Scope Change Requests (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "de_deliverables_accepted",
          label: "Deliverables Accepted Without Rework (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_total_deliverables",
          label: "Total Deliverables (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "de_milestones_on_time",
          label: "Milestones Completed On Time (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_total_milestones",
          label: "Total Milestones (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "de_escalation_count",
          label: "Escalation Count (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_post_delivery_defects",
          label: "Post Delivery Defects (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "de_total_deliveries",
          label: "Total Deliveries (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "on_time_delivery",
          label: "On-Time & On-Budget Delivery (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures percentage of projects delivered on time and within approved budget.",
          formulaText: "(Projects Delivered On Time and Budget / Total Projects Delivered) * 100",
          calcFormula: "(de_projects_on_time_budget / de_total_projects_delivered) * 100",
          targetText: "Target: >= 90%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "scope_change_control",
          label: "Scope Change (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures percentage of project scope changes.",
          formulaText: "(Scope Changes / Total Projects Delivered) * 100",
          calcFormula: "(de_approved_scope_changes / de_total_scope_requests) * 100",
          targetText: "Target Range: 80% - 85%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "first_time_right",
          label: "First Time Right (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures percentage of deliverables accepted by client without requiring rework.",
          formulaText: "(Deliverables Accepted Without Rework / Total Deliverables) * 100",
          calcFormula: "(de_deliverables_accepted / de_total_deliverables) * 100",
          targetText: "Target Range: 90% - 95%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "schedule_adherence",
          label: "Schedule Adherence (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures how well project milestones are delivered as per planned schedule.",
          formulaText: "(Milestones Completed On Time / Total Milestones) * 100",
          calcFormula: "(de_milestones_on_time / de_total_milestones) * 100",
          targetText: "Target: >= 90%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "escalation_rate",
          label: "Escalation Rate (Count)",
          type: MetricType.NUMBER,
          isComputed: true,
          definition: "Measures number of client escalations during delivery period.",
          formulaText: "Total Number of Escalations During Period",
          calcFormula: "de_escalation_count",
          targetText: "Target: <= 1-2 escalations per quarter or project",
          frequency: "Quarterly",
          required: false,
          min: 0,
        },
        {
          key: "post_delivery_defect_rate",
          label: "Post Delivery Defect Rate (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures defects reported after delivery completion.",
          formulaText: "(Post Delivery Defects / Total Deliveries) * 100",
          calcFormula: "(de_post_delivery_defects / de_total_deliveries) * 100",
          targetText: "Target: < 5%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
      ],
    },
    {
      key: "quality_process",
      name: "Quality & Process",
      description: "Ensure adherence to defined processes and maintain high quality standards.",
      weight: 1,
      formula: "(delivery_error_rework_rate + process_compliance_rate + automation_adoption) / 3",
      metrics: [
        {
          key: "qp_rework_count",
          label: "Deliverables Requiring Rework (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "qp_total_deliverables",
          label: "Total Deliverables (Input) - Quality",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "qp_compliant_deliveries",
          label: "Process Compliant Deliveries (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "qp_total_deliveries",
          label: "Total Deliveries (Input) - Process",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "qp_automated_projects",
          label: "AI Adoption Count (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "qp_total_projects",
          label: "Total Projects (Optional Input)",
          type: MetricType.NUMBER,
          required: false,
          min: 0,
        },
        {
          key: "delivery_error_rework_rate",
          label: "Delivery Error / Rework Rate (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures percentage of deliverables requiring correction or rework.",
          formulaText: "(Deliverables Requiring Rework / Total Deliverables) * 100",
          calcFormula: "(qp_rework_count / qp_total_deliverables) * 100",
          targetText: "Target: <= 5%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "process_compliance_rate",
          label: "Process Compliance Rate (%)",
          type: MetricType.PERCENT,
          isComputed: true,
          definition: "Measures adherence to defined SOPs and delivery processes.",
          formulaText: "(Process Compliant Deliveries / Total Deliveries) * 100",
          calcFormula: "(qp_compliant_deliveries / qp_total_deliveries) * 100",
          targetText: "Target: >= 95%",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 100,
        },
        {
          key: "automation_adoption",
          label: "AI Adoption (Count)",
          type: MetricType.NUMBER,
          isComputed: true,
          definition: "Measures the count of AI adoption items identified in the delivery raw sheet.",
          formulaText: "Total Number of AI Adoption Items Completed",
          calcFormula: "qp_automated_projects",
          targetText: "Target: >= 1 AI adoption per measurement period",
          frequency: "Quarterly",
          required: false,
          min: 0,
        },
      ],
    },
    {
      key: "value_client",
      name: "Value Add & Client Satisfaction",
      description: "Deliver additional business value and ensure high client satisfaction.",
      weight: 1,
      formula: "(additional_initiatives_delivered + csat_score) / 2",
      metrics: [
        {
          key: "vc_additional_initiatives",
          label: "Additional Initiatives Completed (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "vc_total_score",
          label: "Total Client Ratings Score (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 0,
        },
        {
          key: "vc_total_responses",
          label: "Total Client Responses (Input)",
          type: MetricType.NUMBER,
          required: true,
          min: 1,
        },
        {
          key: "additional_initiatives_delivered",
          label: "Additional Initiatives Delivered (Count)",
          type: MetricType.NUMBER,
          isComputed: true,
          definition: "Measures number of additional value-added initiatives beyond planned delivery.",
          formulaText: "Total Number of Additional Initiatives Completed",
          calcFormula: "vc_additional_initiatives",
          targetText: "Target: 2-3 initiatives per measurement period",
          frequency: "Quarterly",
          required: false,
          min: 0,
        },
        {
          key: "csat_score",
          label: "Client Satisfaction Score (CSAT)",
          type: MetricType.NUMBER,
          isComputed: true,
          definition: "Measures client satisfaction level based on feedback ratings.",
          formulaText: "Sum of Client Ratings / Total Responses",
          calcFormula: "(vc_total_score / vc_total_responses)",
          targetText: "Target: >= 4.3 out of 5",
          frequency: "Quarterly",
          required: false,
          min: 0,
          max: 5,
        },
      ],
    },
  ],
};

export async function seedDefaultTemplate(preferredCreatorId?: string) {
  const existing = await prisma.kpiTemplate.findFirst({
    where: { name: defaultTemplate.name },
    select: { id: true },
  });
  if (existing) {
    return { created: false, reason: "already-exists" } as const;
  }

  let creatorId = preferredCreatorId;
  if (!creatorId) {
    const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN }, select: { id: true } });
    creatorId = admin?.id;
  }

  if (!creatorId) {
    const fallback = await prisma.user.findFirst({ select: { id: true } });
    creatorId = fallback?.id;
  }

  if (!creatorId) {
    return { created: false, reason: "no-user" } as const;
  }

  await prisma.$transaction(async (tx) => {
    const template = await tx.kpiTemplate.create({
      data: {
        name: defaultTemplate.name,
        description: defaultTemplate.description,
        formula: defaultTemplate.formula,
        isActive: defaultTemplate.isActive,
        createdById: creatorId,
      },
    });

    const createdGoals = await Promise.all(
      defaultTemplate.goals.map((goal, index) =>
        tx.kpiGoal.create({
          data: {
            templateId: template.id,
            key: goal.key,
            name: goal.name,
            description: goal.description ?? null,
            formula: goal.formula ?? null,
            weight: goal.weight ?? null,
            order: index,
          },
        })
      )
    );

    const metricsData = createdGoals.flatMap((goal, goalIndex) =>
      defaultTemplate.goals[goalIndex].metrics.map((metric, metricIndex) => ({
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
        required: metric.required,
        min: metric.min ?? null,
        max: metric.max ?? null,
        weight: metric.weight ?? null,
        order: metricIndex,
      }))
    );

    if (metricsData.length > 0) {
      await tx.kpiMetric.createMany({ data: metricsData });
    }
  });

  return { created: true } as const;
}
