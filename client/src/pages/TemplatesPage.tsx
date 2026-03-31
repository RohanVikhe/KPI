import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.ts";
import type { MetricType, Template } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";

type MetricDraft = {
  key: string;
  label: string;
  type: MetricType;
  isComputed?: boolean;
  definition?: string;
  formulaText?: string;
  calcFormula?: string;
  targetText?: string;
  frequency?: string;
  required: boolean;
  weight?: number | null;
};

type GoalDraft = {
  key: string;
  name: string;
  description?: string;
  formula?: string;
  weight?: number | null;
  metrics: MetricDraft[];
};

const metricTypes: MetricType[] = ["NUMBER", "PERCENT", "CURRENCY"];

const createEmptyMetric = (): MetricDraft => ({
  key: "",
  label: "",
  type: "NUMBER",
  isComputed: false,
  definition: "",
  formulaText: "",
  calcFormula: "",
  targetText: "",
  frequency: "",
  required: true,
  weight: 1,
});

const createEmptyGoal = (): GoalDraft => ({
  key: "",
  name: "",
  description: "",
  formula: "",
  weight: 1,
  metrics: [createEmptyMetric()],
});

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<{ templates: Template[] }>("/templates"),
  });

  const templates = data?.templates ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formula, setFormula] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [goals, setGoals] = useState<GoalDraft[]>([createEmptyGoal()]);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const isEditing = Boolean(editingTemplateId);

  const resetForm = () => {
    setName("");
    setDescription("");
    setFormula("");
    setIsActive(true);
    setGoals([createEmptyGoal()]);
    setEditingTemplateId(null);
  };

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      apiFetch<{ template: Template }>(editingTemplateId ? `/templates/${editingTemplateId}` : "/templates", {
        method: editingTemplateId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      const message = editingTemplateId ? "Template updated." : "Template created.";
      showToast("success", message);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to save template.";
      showToast("error", message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/templates/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      showToast("success", "Template deleted.");
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      if (editingTemplateId) {
        resetForm();
      }
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to delete template.";
      showToast("error", message);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch<{ template: Template }>(`/templates/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      showToast("success", "Template status updated.");
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to update template status.";
      showToast("error", message);
    },
  });

  const goalKeysValid = useMemo(() => {
    const keys = goals.map((goal) => goal.key.trim()).filter(Boolean);
    return keys.length === goals.length && new Set(keys).size === keys.length;
  }, [goals]);

  const metricKeysValid = useMemo(() => {
    const keys = goals
      .flatMap((goal) => goal.metrics.map((metric) => metric.key.trim()))
      .filter(Boolean);
    const metricsCount = goals.reduce((acc, goal) => acc + goal.metrics.length, 0);
    return keys.length === metricsCount && new Set(keys).size === keys.length;
  }, [goals]);

  const updateGoal = (index: number, patch: Partial<GoalDraft>) => {
    setGoals((prev) => prev.map((goal, idx) => (idx === index ? { ...goal, ...patch } : goal)));
  };

  const updateMetric = (goalIndex: number, metricIndex: number, patch: Partial<MetricDraft>) => {
    setGoals((prev) =>
      prev.map((goal, idx) => {
        if (idx !== goalIndex) return goal;
        return {
          ...goal,
          metrics: goal.metrics.map((metric, mIdx) => (mIdx === metricIndex ? { ...metric, ...patch } : metric)),
        };
      })
    );
  };

  const addGoal = () => {
    setGoals((prev) => [...prev, createEmptyGoal()]);
  };

  const removeGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, idx) => idx !== index));
  };

  const addMetric = (goalIndex: number) => {
    setGoals((prev) =>
      prev.map((goal, idx) =>
        idx === goalIndex ? { ...goal, metrics: [...goal.metrics, createEmptyMetric()] } : goal
      )
    );
  };

  const removeMetric = (goalIndex: number, metricIndex: number) => {
    setGoals((prev) =>
      prev.map((goal, idx) => {
        if (idx !== goalIndex) return goal;
        return { ...goal, metrics: goal.metrics.filter((_, mIdx) => mIdx !== metricIndex) };
      })
    );
  };

  const loadTemplate = (template: Template) => {
    setEditingTemplateId(template.id);
    setName(template.name);
    setDescription(template.description ?? "");
    setFormula(template.formula ?? "");
    setIsActive(template.isActive);
    setGoals(
      template.goals.map((goal) => ({
        key: goal.key,
        name: goal.name,
        description: goal.description ?? "",
        formula: goal.formula ?? "",
        weight: goal.weight ?? null,
        metrics: goal.metrics.map((metric) => ({
          key: metric.key,
          label: metric.label,
          type: metric.type,
          isComputed: metric.isComputed ?? false,
          definition: metric.definition ?? "",
          formulaText: metric.formulaText ?? "",
          calcFormula: metric.calcFormula ?? "",
          targetText: metric.targetText ?? "",
          frequency: metric.frequency ?? "",
          required: metric.required,
          weight: metric.weight ?? null,
        })),
      }))
    );
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      const message = "Template name is required.";
      showToast("error", message);
      return;
    }

    if (goals.length === 0) {
      const message = "At least one goal is required.";
      showToast("error", message);
      return;
    }

    if (!goalKeysValid) {
      const message = "Goal keys must be unique and non-empty.";
      showToast("error", message);
      return;
    }

    if (!metricKeysValid) {
      const message = "Metric keys must be unique and non-empty.";
      showToast("error", message);
      return;
    }

    for (const goal of goals) {
      if (!goal.name.trim()) {
        const message = "Each goal must have a name.";
        showToast("error", message);
        return;
      }
      if (goal.metrics.length === 0) {
        const message = "Each goal must contain at least one metric.";
        showToast("error", message);
        return;
      }
    }

    mutation.mutate({
      name,
      description: description || null,
      formula: formula || null,
      isActive,
      goals: goals.map((goal, goalIndex) => ({
        key: goal.key.trim(),
        name: goal.name.trim(),
        description: goal.description?.trim() ? goal.description.trim() : null,
        formula: goal.formula?.trim() ? goal.formula.trim() : null,
        weight: goal.weight ?? null,
        order: goalIndex,
        metrics: goal.metrics.map((metric, metricIndex) => ({
          ...metric,
          key: metric.key.trim(),
          label: metric.label.trim() || metric.key.trim(),
          isComputed: metric.isComputed ?? false,
          definition: metric.definition?.trim() ? metric.definition.trim() : null,
          formulaText: metric.formulaText?.trim() ? metric.formulaText.trim() : null,
          calcFormula: metric.calcFormula?.trim() ? metric.calcFormula.trim() : null,
          targetText: metric.targetText?.trim() ? metric.targetText.trim() : null,
          frequency: metric.frequency?.trim() ? metric.frequency.trim() : null,
          order: metricIndex,
        })),
      })),
    });
  };

  return (
    <div className="page">
      {toast && (
        <MessageToast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      <form className="panel form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h3>{isEditing ? "Edit KPI Template" : "Create KPI Template"}</h3>
          <span className="panel-sub">Define goals, metrics, and optional formula logic.</span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Quarterly Sales KPI" />
          </label>
          <label className="form-field">
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Sales performance template"
            />
          </label>
          <label className="form-field">
            <span>Overall Formula (optional)</span>
            <input
              value={formula}
              onChange={(event) => setFormula(event.target.value)}
              placeholder="(financial + delivery_efficiency) / 2"
            />
          </label>
          <label className="form-field switch">
            <span>Active</span>
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          </label>
        </div>

        <div className="goal-builder">
          <div className="metric-header">
            <h4>Goals</h4>
            <button type="button" className="btn btn-ghost" onClick={addGoal}>
              Add goal
            </button>
          </div>

          {goals.map((goal, goalIndex) => (
            <div key={`goal-${goalIndex}`} className="goal-section">
              <div className="goal-header">
                <h4>Goal {goalIndex + 1}</h4>
                <button type="button" className="btn btn-ghost" onClick={() => removeGoal(goalIndex)}>
                  Remove goal
                </button>
              </div>

              <div className="form-grid">
                <label className="form-field">
                  <span>Goal Key</span>
                  <input
                    value={goal.key}
                    onChange={(event) => updateGoal(goalIndex, { key: event.target.value })}
                    placeholder="financial"
                  />
                </label>
                <label className="form-field">
                  <span>Goal Name</span>
                  <input
                    value={goal.name}
                    onChange={(event) => updateGoal(goalIndex, { name: event.target.value })}
                    placeholder="Financial"
                  />
                </label>
                <label className="form-field">
                  <span>Goal Weight</span>
                  <input
                    type="number"
                    value={goal.weight ?? ""}
                    onChange={(event) =>
                      updateGoal(goalIndex, { weight: event.target.value ? Number(event.target.value) : null })
                    }
                    placeholder="1"
                  />
                </label>
                <label className="form-field">
                  <span>Goal Formula</span>
                  <input
                    value={goal.formula}
                    onChange={(event) => updateGoal(goalIndex, { formula: event.target.value })}
                    placeholder="(on_time_delivery + first_time_right) / 2"
                  />
                </label>
                <label className="form-field">
                  <span>Goal Description</span>
                  <input
                    value={goal.description}
                    onChange={(event) => updateGoal(goalIndex, { description: event.target.value })}
                    placeholder="Delivery efficiency, quality, and process adherence overview"
                  />
                </label>
              </div>

              <div className="metric-builder">
                <div className="metric-header">
                  <h4>Metrics</h4>
                  <button type="button" className="btn btn-ghost" onClick={() => addMetric(goalIndex)}>
                    Add metric
                  </button>
                </div>

                {goal.metrics.map((metric, metricIndex) => (
                  <div key={`metric-${goalIndex}-${metricIndex}`} className="metric-row">
                    <input
                      placeholder="key (e.g. revenue)"
                      value={metric.key}
                      onChange={(event) => updateMetric(goalIndex, metricIndex, { key: event.target.value })}
                    />
                    <input
                      placeholder="Label"
                      value={metric.label}
                      onChange={(event) => updateMetric(goalIndex, metricIndex, { label: event.target.value })}
                    />
                    <select
                      value={metric.type}
                      onChange={(event) => updateMetric(goalIndex, metricIndex, { type: event.target.value as MetricType })}
                    >
                      {metricTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="Weight"
                      value={metric.weight ?? ""}
                      onChange={(event) =>
                        updateMetric(goalIndex, metricIndex, {
                          weight: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    />
                    <label className="metric-toggle">
                      <input
                        type="checkbox"
                        checked={metric.required}
                        onChange={(event) => updateMetric(goalIndex, metricIndex, { required: event.target.checked })}
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeMetric(goalIndex, metricIndex)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : isEditing ? "Update template" : "Create template"}
          </button>
          {isEditing && (
            <button className="btn btn-ghost" type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="panel">
        <div className="panel-header">
          <h3>Existing Templates</h3>
          <span className="panel-sub">Overview of KPI structures in use.</span>
        </div>
        <div className="template-list">
          {templates.map((template) => (
            <div key={template.id} className="template-card">
              <div>
                <h4>{template.name}</h4>
                <p>{template.description}</p>
              </div>
              <div className="template-meta">
                <span className="status-pill">{template.isActive ? "Active" : "Inactive"}</span>
                <span>{template.goals?.length ?? 0} goals</span>
              </div>
              <div className="template-actions">
                <button className="btn btn-ghost" type="button" onClick={() => loadTemplate(template)}>
                  Edit
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() =>
                    statusMutation.mutate({
                      id: template.id,
                      isActive: !template.isActive,
                    })
                  }
                  disabled={statusMutation.isPending}
                >
                  {template.isActive ? "Deactivate" : "Activate"}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Delete this template and all related submissions? This cannot be undone."
                      )
                    )
                      return;
                    deleteMutation.mutate(template.id);
                  }}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {templates.length === 0 && <div className="empty-state">No templates yet.</div>}
        </div>
      </div>
    </div>
  );
}
