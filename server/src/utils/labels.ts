export function normalizeMetricLabel(label: string | null | undefined) {
  if (label === "Automation Adoption (%)") {
    return "AI Adoption (%)";
  }
  return label ?? "";
}

type TemplateMetricLike = {
  label: string | null;
};

type TemplateGoalLike = {
  metrics: TemplateMetricLike[];
};

type TemplateLike = {
  goals: TemplateGoalLike[];
};

export function normalizeTemplateMetricLabels<T extends TemplateLike>(template: T): T {
  return {
    ...template,
    goals: template.goals.map((goal) => ({
      ...goal,
      metrics: goal.metrics.map((metric) => ({
        ...metric,
        label: normalizeMetricLabel(metric.label),
      })),
    })),
  };
}

export function normalizeSubmissionTemplateLabels<
  T extends {
    template?: TemplateLike | null;
  },
>(submission: T): T {
  if (!submission.template) {
    return submission;
  }

  return {
    ...submission,
    template: normalizeTemplateMetricLabels(submission.template),
  };
}
