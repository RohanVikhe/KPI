export function normalizeMetricLabel(label) {
    if (label === "Automation Adoption (%)") {
        return "AI Adoption (%)";
    }
    return label ?? "";
}
export function normalizeTemplateMetricLabels(template) {
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
export function normalizeSubmissionTemplateLabels(submission) {
    if (!submission.template) {
        return submission;
    }
    return {
        ...submission,
        template: normalizeTemplateMetricLabels(submission.template),
    };
}
