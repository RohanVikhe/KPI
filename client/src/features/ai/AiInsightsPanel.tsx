import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api.ts";

type InsightsResponse = {
  insights: {
    alerts: string[];
    narrative: string;
  };
};

type AiInsightsPanelProps = {
  submissionId: string;
  employeeName: string;
  onDraftGenerated: (draft: string) => void;
};

export default function AiInsightsPanel({ submissionId, employeeName, onDraftGenerated }: AiInsightsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ai-insights", submissionId],
    queryFn: () => apiFetch<InsightsResponse>(`/ai/submissions/${submissionId}/insights`),
    staleTime: 1000 * 60 * 10, // 10 minutes cache
    enabled: isExpanded, // only fetch when user opens the panel
  });

  const { alerts, narrative } = data?.insights ?? { alerts: [], narrative: "" };

  return (
    <div
      style={{
        background: "rgba(242, 157, 56, 0.06)",
        border: "1px solid rgba(242, 157, 56, 0.25)",
        borderRadius: "14px",
        padding: "20px 24px",
        marginBottom: "0",
      }}
    >
      {/* Header row with toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="ai-pulse-icon" style={{ fontSize: "18px", color: "#f29d38" }}>✦</span>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#f29d38" }}>
              AI Insights — {employeeName}
            </h3>
          </div>
          <p style={{ margin: "4px 0 0 28px", fontSize: "0.8rem", color: "rgba(247,244,239,0.5)" }}>
            Integrity checks & auto-drafted review feedback for this submission
          </p>
        </div>
        <button
          id="ai-insights-toggle"
          className="btn btn-ghost"
          style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
          onClick={() => {
            setIsExpanded((prev) => !prev);
          }}
        >
          {isExpanded ? "Hide Insights" : "Generate Insights"}
        </button>
      </div>

      {/* Expandable body */}
      {isExpanded && (
        <div className="ai-content-fade" style={{ marginTop: "20px", borderTop: "1px solid rgba(242,157,56,0.15)", paddingTop: "18px" }}>
          {(isLoading || isFetching) && !data ? (
            <div style={{ display: "grid", gap: "12px", padding: "8px 0" }}>
              <div className="ai-loading-shimmer" style={{ height: "14px", width: "30%" }} />
              <div className="ai-loading-shimmer" style={{ height: "100px", width: "100%" }} />
            </div>
          ) : error ? (
            <div style={{ color: "#f35f8a", fontSize: "0.875rem" }}>
              Unable to generate insights. Please try again.{" "}
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                onClick={() => refetch()}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Integrity Alerts */}
              <div style={{ marginBottom: "18px" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", color: "#f29d38", textTransform: "uppercase", marginBottom: "8px" }}>
                  Integrity & Quality Alerts
                </div>
                {alerts.length === 0 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 14px",
                      background: "rgba(68,217,230,0.08)",
                      border: "1px solid rgba(68,217,230,0.2)",
                      borderRadius: "8px",
                      fontSize: "0.85rem",
                      color: "#44d9e6",
                    }}
                  >
                    <span>✓</span> No anomalies detected in {employeeName}&apos;s delivery data.
                  </div>
                ) : (
                  <ul style={{ margin: 0, padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {alerts.map((alert, idx) => (
                      <li
                        key={idx}
                        style={{
                          padding: "10px 14px",
                          background: "rgba(243, 95, 138, 0.08)",
                          border: "1px solid rgba(243, 95, 138, 0.25)",
                          borderRadius: "8px",
                          fontSize: "0.85rem",
                          color: "#f35f8a",
                          display: "flex",
                          gap: "8px",
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>⚠</span>
                        {alert}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Narrative */}
              <div>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", color: "#f29d38", textTransform: "uppercase", marginBottom: "8px" }}>
                  Draft Review Feedback
                </div>
                <div
                  style={{
                    padding: "14px 16px",
                    background: "rgba(12,17,24,0.6)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    fontSize: "0.875rem",
                    color: "rgba(247,244,239,0.85)",
                    lineHeight: "1.6",
                    fontStyle: "italic",
                    marginBottom: "12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {narrative || "No narrative generated."}
                </div>
                <button
                  id="ai-use-draft-btn"
                  className="btn btn-primary"
                  style={{ fontSize: "0.85rem" }}
                  onClick={() => onDraftGenerated(narrative)}
                  disabled={!narrative}
                >
                  Use Draft in Review Comment
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
