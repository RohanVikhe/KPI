import { Parser } from "expr-eval";
import { AppError } from "./errors.js";
function evaluateFormula(formula, variables) {
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
        if (typeof result !== "number") {
            throw new AppError("Formula did not return a number", 400, "FORMULA_INVALID");
        }
        if (!Number.isFinite(result)) {
            // Allow divide-by-zero style expressions (Infinity/NaN) to resolve as 0 instead of hard-failing a submission.
            return 0;
        }
        return result;
    }
    catch (error) {
        if (error instanceof AppError)
            throw error;
        throw new AppError("Invalid formula", 400, "FORMULA_INVALID");
    }
}
export function computeScore(input) {
    const { formula, metrics, values } = input;
    const strict = input.strict !== false;
    const hasFormula = Boolean(formula && formula.trim().length > 0);
    if (metrics.length === 0)
        return null;
    const valueMap = new Map(values.map((value) => [value.metricId, value.valueNumber]));
    const variables = {};
    const numericValues = [];
    const computedMetrics = metrics.filter((metric) => metric.isComputed);
    const allowZeroDefaults = hasFormula || computedMetrics.length > 0;
    let missingRequired = false;
    for (const metric of metrics) {
        if (metric.isComputed) {
            continue;
        }
        const rawValue = valueMap.get(metric.id);
        if (metric.required && (rawValue === null || rawValue === undefined)) {
            if (strict) {
                throw new AppError(`Missing value for metric ${metric.key}`, 400, "MISSING_METRIC");
            }
            missingRequired = true;
            if (allowZeroDefaults) {
                variables[metric.key] = 0;
            }
            continue;
        }
        if (rawValue === null || rawValue === undefined) {
            if (allowZeroDefaults) {
                // Treat missing optional values as 0 when a formula references them.
                variables[metric.key] = 0;
            }
            continue;
        }
        const allowZeroForPositiveMinimum = rawValue === 0 && metric.min !== null && metric.min !== undefined && metric.min > 0;
        if (!allowZeroForPositiveMinimum &&
            metric.min !== null &&
            metric.min !== undefined &&
            rawValue < metric.min) {
            if (strict) {
                throw new AppError(`Value below minimum for ${metric.key}`, 400, "METRIC_MIN");
            }
        }
        if (metric.max !== null && metric.max !== undefined && rawValue > metric.max) {
            if (strict) {
                throw new AppError(`Value above maximum for ${metric.key}`, 400, "METRIC_MAX");
            }
        }
        variables[metric.key] = rawValue;
        numericValues.push(rawValue);
    }
    for (const metric of computedMetrics) {
        if (!metric.calcFormula || !metric.calcFormula.trim())
            continue;
        const computedValue = evaluateFormula(metric.calcFormula, variables);
        let finalValue = computedValue;
        if (metric.min !== null && metric.min !== undefined) {
            finalValue = Math.max(metric.min, finalValue);
        }
        if (metric.max !== null && metric.max !== undefined) {
            finalValue = Math.min(metric.max, finalValue);
        }
        variables[metric.key] = finalValue;
        numericValues.push(finalValue);
    }
    if (missingRequired && !strict) {
        return null;
    }
    if (hasFormula) {
        return evaluateFormula(formula, variables);
    }
    if (numericValues.length === 0)
        return null;
    const weightedMetrics = metrics.filter((metric) => metric.weight !== null && metric.weight !== undefined);
    if (weightedMetrics.length > 0) {
        let totalWeight = 0;
        let totalScore = 0;
        for (const metric of weightedMetrics) {
            const value = metric.isComputed ? variables[metric.key] : valueMap.get(metric.id);
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
export function computeGoalScores(goals, values, options) {
    const goalScores = goals.map((goal) => ({
        goalId: goal.id,
        key: goal.key,
        name: goal.name,
        weight: goal.weight ?? null,
        score: computeScore({
            formula: goal.formula,
            metrics: goal.metrics,
            values,
            strict: options?.strict,
        }),
    }));
    return goalScores;
}
export function computeOverallScore(input) {
    const goalScores = computeGoalScores(input.goals, input.values, { strict: input.strict });
    const validScores = goalScores.filter((goal) => goal.score !== null && goal.score !== undefined);
    if (input.overallFormula && input.overallFormula.trim().length > 0) {
        const variables = {};
        goalScores.forEach((goal) => {
            variables[goal.key] = goal.score ?? 0;
        });
        const score = evaluateFormula(input.overallFormula, variables);
        return { score, goalScores };
    }
    if (validScores.length === 0) {
        return { score: null, goalScores };
    }
    const weightedGoals = validScores.filter((goal) => goal.weight !== null && goal.weight !== undefined);
    if (weightedGoals.length > 0) {
        let totalWeight = 0;
        let totalScore = 0;
        for (const goal of weightedGoals) {
            const weight = goal.weight ?? 0;
            totalWeight += weight;
            totalScore += (goal.score ?? 0) * weight;
        }
        return { score: totalWeight > 0 ? totalScore / totalWeight : null, goalScores };
    }
    const sum = validScores.reduce((acc, goal) => acc + (goal.score ?? 0), 0);
    return { score: sum / validScores.length, goalScores };
}
export function computeMetricValues(metrics, values) {
    const valueMap = new Map(values.map((value) => [value.metricId, value.valueNumber]));
    const variables = {};
    const resolved = new Map();
    for (const metric of metrics) {
        if (metric.isComputed)
            continue;
        const rawValue = valueMap.get(metric.id);
        if (rawValue === null || rawValue === undefined)
            continue;
        variables[metric.key] = rawValue;
        resolved.set(metric.id, rawValue);
    }
    for (const metric of metrics) {
        if (!metric.isComputed || !metric.calcFormula || !metric.calcFormula.trim())
            continue;
        try {
            const computedValue = evaluateFormula(metric.calcFormula, variables);
            let finalValue = computedValue;
            if (metric.min !== null && metric.min !== undefined) {
                finalValue = Math.max(metric.min, finalValue);
            }
            if (metric.max !== null && metric.max !== undefined) {
                finalValue = Math.min(metric.max, finalValue);
            }
            variables[metric.key] = finalValue;
            resolved.set(metric.id, finalValue);
        }
        catch {
            // Skip invalid formulas in display output.
        }
    }
    return resolved;
}
