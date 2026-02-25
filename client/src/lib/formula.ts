import { Parser } from "expr-eval";

const parser = new Parser({
  operators: {
    logical: false,
    comparison: true,
    in: false,
    assignment: false,
  },
});

export function evaluateFormula(formula: string, variables: Record<string, number>): number | null {
  if (!formula || !formula.trim()) return null;
  try {
    const expr = parser.parse(formula);
    const requiredVars = expr.variables();
    for (const name of requiredVars) {
      if (!(name in variables)) {
        return null;
      }
    }
    const result = expr.evaluate(variables);
    if (typeof result !== "number") {
      return null;
    }
    if (!Number.isFinite(result)) {
      return 0;
    }
    return result;
  } catch {
    return null;
  }
}
