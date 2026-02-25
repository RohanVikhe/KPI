import { Parser } from "expr-eval";
import { AppError } from "./errors.js";
export function computeScore(input) {
    const { formula, metrics, values } = input;
    if (metrics.length === 0)
        return null;
    const valueMap = new Map(values.map((value) => [value.metricId, value.valueNumber]));
    const variables = {};
    const numericValues = [];
    for (const metric of metrics) {
        const rawValue = valueMap.get(metric.id);
        if (metric.required && (rawValue === null || rawValue === undefined)) {
            throw new AppError(`Missing value for metric ${metric.key}`, 400, "MISSING_METRIC");
        }
        if (rawValue === null || rawValue === undefined) {
            continue;
        }
        if (metric.min !== null && metric.min !== undefined && rawValue < metric.min) {
            throw new AppError(`Value below minimum for ${metric.key}`, 400, "METRIC_MIN");
        }
        if (metric.max !== null && metric.max !== undefined && rawValue > metric.max) {
            throw new AppError(`Value above maximum for ${metric.key}`, 400, "METRIC_MAX");
        }
        variables[metric.key] = rawValue;
        numericValues.push(rawValue);
    }
    if (numericValues.length === 0)
        return null;
    if (formula && formula.trim().length > 0) {
        const parser = new Parser({
            operators: {
                logical: false,
                comparison: true,
                in: false,
                assignment: false,
            },
        });
        try {
            const expr = parser.parse(formula);
            const result = expr.evaluate(variables);
            if (typeof result !== "number" || !Number.isFinite(result)) {
                throw new AppError("Formula did not return a number", 400, "FORMULA_INVALID");
            }
            return result;
        }
        catch (error) {
            if (error instanceof AppError)
                throw error;
            throw new AppError("Invalid formula", 400, "FORMULA_INVALID");
        }
    }
    const weightedMetrics = metrics.filter((metric) => metric.weight !== null && metric.weight !== undefined);
    if (weightedMetrics.length > 0) {
        let totalWeight = 0;
        let totalScore = 0;
        for (const metric of weightedMetrics) {
            const value = valueMap.get(metric.id);
            if (value === null || value === undefined)
                continue;
            const weight = metric.weight ?? 0;
            totalWeight += weight;
            totalScore += value * weight;
        }
        return totalWeight > 0 ? totalScore / totalWeight : null;
    }
    const sum = numericValues.reduce((acc, current) => acc + current, 0);
    return sum / numericValues.length;
}
