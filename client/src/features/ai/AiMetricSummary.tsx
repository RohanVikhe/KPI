import { useState } from "react";
import { apiFetch } from "../../lib/api.ts";

type MetricRow = {
  label: string;
  value: number;
  type: "NUMBER" | "PERCENT" | "CURRENCY";
};

type AiMetricSummaryProps = {
  employeeName: string;
  metrics: MetricRow[];
  dateRange?: string;
  isTeamView?: boolean;
};

type InsightResult = {
  alerts: string[];
  narrative: string;
};

function formatValue(value: number, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (!Number.isFinite(value)) return "--";
  if (type === "PERCENT") return `${value.toFixed(2)}%`;
  if (type === "CURRENCY") return `$${value.toFixed(2)}`;
  return value.toFixed(2);
}

export default function AiMetricSummary({ employeeName, metrics, dateRange, isTeamView }: AiMetricSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (result && isExpanded) {
      setIsExpanded(false);
      return;
    }
    setIsExpanded(true);
    if (result) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ insights: InsightResult }>("/ai/snapshot-insights", {
        method: "POST",
        body: JSON.stringify({
          employeeName,
          dateRange,
          isTeamView,
          metrics: metrics.map((m) => ({
            label: m.label,
            value: formatValue(m.value, m.type),
          })),
        }),
      });
      setResult(res.insights);
    } catch (err: any) {
      setError(err?.message ?? "Failed to generate AI summary.");
    } finally {
      setIsLoading(false);
    }
  }

  if (metrics.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(68, 217, 230, 0.05)",
        border: "1px solid rgba(68, 217, 230, 0.2)",
        borderRadius: "12px",
        padding: "16px 20px",
        marginTop: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="ai-pulse-icon" style={{ fontSize: "16px", color: "#44d9e6" }}>✦</span>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#44d9e6" }}>
              {isTeamView ? "AI Team Performance Summary" : `AI Metric Summary — ${employeeName}`}
            </span>
          </div>
          <p style={{ margin: "3px 0 0 24px", fontSize: "0.75rem", color: "rgba(247,244,239,0.45)" }}>
            {isTeamView 
              ? `Consolidated team analysis for ${dateRange || "the selected period"}`
              : `Detailed narrative for ${employeeName} across ${dateRange || "the selected period"}`}
          </p>
        </div>
        <button
          id="ai-metric-summary-btn"
          className="btn btn-ghost"
          style={{ fontSize: "0.8rem", borderColor: "rgba(68,217,230,0.3)", color: "#44d9e6" }}
          onClick={handleGenerate}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : result && isExpanded ? "Hide Summary" : "Generate Summary"}
        </button>
      </div>

      {isExpanded && (
        <div className="ai-content-fade" style={{ marginTop: "14px", borderTop: "1px solid rgba(68,217,230,0.15)", paddingTop: "14px" }}>
          {isLoading ? (
            <div style={{ display: "grid", gap: "12px", padding: "8px 0" }}>
              <div className="ai-loading-shimmer" style={{ height: "14px", width: "40%" }} />
              <div className="ai-loading-shimmer" style={{ height: "60px", width: "100%" }} />
            </div>
          ) : error ? (
            <div style={{ color: "#f35f8a", fontSize: "0.85rem" }}>{error}</div>
          ) : result ? (
            <>
              {/* Alerts */}
              {result.alerts.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#f29d38", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
                    Anomalies & Trends
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "5px" }}>
                    {result.alerts.map((alert, idx) => (
                      <li
                        key={idx}
                        style={{
                          padding: "8px 12px",
                          background: "rgba(243,95,138,0.08)",
                          border: "1px solid rgba(243,95,138,0.2)",
                          borderRadius: "7px",
                          fontSize: "0.82rem",
                          color: "#f35f8a",
                          display: "flex",
                          gap: "8px",
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>⚠</span>{alert}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Narrative */}
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#44d9e6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
                  {isTeamView ? "Team Performance Narrative" : "Individual Performance Narrative"}
                </div>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "rgba(12,17,24,0.6)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    color: "rgba(247,244,239,0.85)",
                    lineHeight: "1.6",
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {result.narrative || "No narrative generated."}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
