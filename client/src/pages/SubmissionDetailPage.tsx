import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiDownload, apiFetch } from "../lib/api.ts";
import { evaluateFormula } from "../lib/formula.ts";
import type { Comment, Review, Submission } from "../lib/types.ts";
import { useAuth } from "../lib/auth.tsx";
import MessageToast from "../components/MessageToast.tsx";

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSubmittedDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusClass(status: string) {
  return `status-pill status-${status.toLowerCase()}`;
}

const RAW_ROWS_PER_PAGE = 10;
const RAW_PLACEHOLDER_VALUES = new Set(["", "-", "--", "n/a", "na"]);
const RAW_IGNORED_ROW_HEADERS = new Set(["srno", "sno", "serialno", "serialnumber"]);

function hasMeaningfulRawValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !RAW_PLACEHOLDER_VALUES.has(normalized);
}

function hasMeaningfulRawLink(value: string | null | undefined) {
  return String(value ?? "").trim().length > 0;
}

function normalizeRawHeader(header: string | null | undefined) {
  return String(header ?? "").trim();
}

function normalizeRawHeaderKey(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRowPresenceHeader(header: string) {
  if (!header) return false;
  const normalizedKey = normalizeRawHeaderKey(header);
  if (RAW_IGNORED_ROW_HEADERS.has(normalizedKey)) return false;
  return !/\bflag\b/i.test(header);
}

function resolveRawDataLink(value: string) {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  if (!trimmed) return null;

  const embeddedUrlMatch = trimmed.match(/https?:\/\/[^\s)]+/i);
  if (embeddedUrlMatch) {
    return embeddedUrlMatch[0];
  }

  const formulaLinkMatch = trimmed.match(/HYPERLINK\(\s*"((?:[^"]|"")+)"/i);
  if (formulaLinkMatch) {
    const extracted = formulaLinkMatch[1].replace(/""/g, "\"").trim();
    if (extracted) return extracted;
  }

  try {
    const direct = new URL(trimmed);
    if (direct.protocol === "http:" || direct.protocol === "https:") {
      return direct.href;
    }
    return null;
  } catch {
    const looksLikeDomain = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(trimmed);
    if (!/^www\./i.test(trimmed) && !looksLikeDomain) {
      return null;
    }
    try {
      const withScheme = new URL(`https://${trimmed}`);
      return withScheme.href;
    } catch {
      return null;
    }
  }
}

export default function SubmissionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [reviewStatus, setReviewStatus] = useState<Review["status"]>("APPROVED");
  const [reviewComment, setReviewComment] = useState("");
  const [rawPage, setRawPage] = useState(1);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["submission", id],
    queryFn: () => apiFetch<{ submission: Submission }>(`/submissions/${id}`),
    enabled: Boolean(id),
  });

  const submission = data?.submission;
  const hasReviewRole = user?.role === "MANAGER" || user?.role === "ADMIN";
  const isOwnSubmission = Boolean(user?.id && submission?.userId === user.id);
  const canReview = hasReviewRole && !isOwnSubmission;

  const goalSections = useMemo(() => {
    if (!submission) return [];
    const rawValueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
    const resolvedValues = new Map<string, number>();
    const variables: Record<string, number> = {};

    submission.template.goals.forEach((goal) => {
      goal.metrics.forEach((metric) => {
        if (metric.isComputed) return;
        const raw = rawValueMap.get(metric.id);
        if (raw === null || raw === undefined) return;
        variables[metric.key] = raw;
        resolvedValues.set(metric.id, raw);
      });
    });

    submission.template.goals.forEach((goal) => {
      goal.metrics.forEach((metric) => {
        if (!metric.isComputed || !metric.calcFormula) return;
        const result = evaluateFormula(metric.calcFormula, variables);
        if (result === null) return;
        variables[metric.key] = result;
        resolvedValues.set(metric.id, result);
      });
    });

    const goalScoreMap = new Map((submission.goalScores ?? []).map((goal) => [goal.goalId, goal.score]));
    const goalNoteMap = new Map((submission.goalNotes ?? []).map((note) => [note.goalId, note.note]));
    return submission.template.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      description: goal.description,
      score: goalScoreMap.get(goal.id) ?? null,
      note: goalNoteMap.get(goal.id) ?? null,
      metrics: goal.metrics.map((metric) => ({
        id: metric.id,
        label: metric.label,
        value: resolvedValues.get(metric.id) ?? null,
      })),
    }));
  }, [submission]);

  const rawDeliveryData = useMemo(() => {
    if (!submission?.rawDeliveryData || submission.rawDeliveryData.rows.length === 0) {
      return null;
    }

    const headers = submission.rawDeliveryData.headers ?? [];
    const rows = submission.rawDeliveryData.rows ?? [];
    const links = submission.rawDeliveryData.links ?? [];
    const normalizedHeaders = headers.map((header) => normalizeRawHeader(header));
    const rowPresenceColumnIndexes = normalizedHeaders
      .map((header, index) => ({ index, header }))
      .filter(({ header }) => isRowPresenceHeader(header))
      .map(({ index }) => index);
    const indexedRows = rows.map((row, rowIndex) => ({
      row,
      links: Array.isArray(links[rowIndex]) ? links[rowIndex] : [],
    }));
    const meaningfulRows = indexedRows.filter(({ row, links: rowLinks }) =>
      rowPresenceColumnIndexes.some(
        (columnIndex) =>
          hasMeaningfulRawValue(row[columnIndex]) || hasMeaningfulRawLink(String(rowLinks[columnIndex] ?? ""))
      )
    );

    if (meaningfulRows.length === 0) {
      return null;
    }

    const visibleColumnIndexes = headers
      .map((header, index) => ({ index, header: normalizeRawHeader(header) }))
      .filter(({ index, header }) => {
        if (!header) return false;
        if (RAW_IGNORED_ROW_HEADERS.has(normalizeRawHeaderKey(header))) return true;
        return meaningfulRows.some(
          ({ row, links: rowLinks }) =>
            hasMeaningfulRawValue(row[index]) || hasMeaningfulRawLink(String(rowLinks[index] ?? ""))
        );
      })
      .map(({ index }) => index);

    if (visibleColumnIndexes.length === 0) {
      return null;
    }

    const compactHeaders = visibleColumnIndexes.map(
      (columnIndex) => normalizedHeaders[columnIndex] || `Column ${columnIndex + 1}`
    );
    const compactRows = meaningfulRows.map(({ row }) =>
      visibleColumnIndexes.map((columnIndex) => String(row[columnIndex] ?? "").trim())
    );
    const compactLinks = meaningfulRows.map(({ links: rowLinks }) =>
      visibleColumnIndexes.map((columnIndex) => {
        const linkValue = String(rowLinks[columnIndex] ?? "").trim();
        return linkValue.length > 0 ? linkValue : null;
      })
    );
    const hasAnyLinks = compactLinks.some((rowLinks) => rowLinks.some((link) => Boolean(link)));

    return {
      sheetName: submission.rawDeliveryData.sheetName,
      headers: compactHeaders,
      rows: compactRows,
      links: hasAnyLinks ? compactLinks : undefined,
    };
  }, [submission?.rawDeliveryData]);

  const rawTotalPages = rawDeliveryData ? Math.max(1, Math.ceil(rawDeliveryData.rows.length / RAW_ROWS_PER_PAGE)) : 1;
  const rawPageStart = (rawPage - 1) * RAW_ROWS_PER_PAGE;
  const rawPageRows = rawDeliveryData
    ? rawDeliveryData.rows.slice(rawPageStart, rawPageStart + RAW_ROWS_PER_PAGE)
    : [];
  const rawPageLinks = rawDeliveryData?.links
    ? rawDeliveryData.links.slice(rawPageStart, rawPageStart + RAW_ROWS_PER_PAGE)
    : [];

  useEffect(() => {
    setRawPage(1);
  }, [submission?.id, rawDeliveryData?.rows.length]);

  useEffect(() => {
    if (rawPage > rawTotalPages) {
      setRawPage(rawTotalPages);
    }
  }, [rawPage, rawTotalPages]);

  const commentMutation = useMutation({
    mutationFn: (message: string) =>
      apiFetch<{ comment: Comment }>(`/submissions/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      setComment("");
      showToast("success", "Comment added.");
      refetch();
    },
    onError: (err: any) => {
      showToast("error", err?.message ?? "Unable to add comment.");
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (payload: { status: Review["status"]; comment?: string }) =>
      apiFetch<{ review: Review; submission: Submission }>(`/submissions/${id}/review`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (_data, variables) => {
      setReviewComment("");
      showToast("success", `Review submitted: ${variables.status.replace("_", " ")}.`);
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["submissions"] }),
        queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      ]);
    },
    onError: (err: any) => {
      showToast("error", err?.message ?? "Unable to submit review.");
    },
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      apiDownload(`/submissions/${id}/report`, {
        method: "POST",
      }),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const fallbackUserSlug =
        submission?.user?.name
          ?.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "user";
      link.download = fileName ?? `KPI-report-${fallbackUserSlug}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("success", "Report generated and downloaded.");
    },
    onError: (err: any) => {
      showToast("error", err?.message ?? "Unable to generate report.");
    },
  });

  if (isLoading) {
    return <div className="panel">Loading submission...</div>;
  }

  if (loadError || !submission) {
    return <div className="panel">Unable to load submission details.</div>;
  }

  return (
    <div className="page">
      {toast && (
        <MessageToast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      <div className="panel detail-hero">
        <div>
          <div className="detail-title">{submission.template.name}</div>
          <div className="detail-sub">
            Period {formatDate(submission.periodStart)} - {formatDate(submission.periodEnd)}
          </div>
          <div className="detail-sub">Submitted on {formatSubmittedDate(submission.submittedAt)}</div>
        </div>
        <div className="detail-meta">
          <span className={statusClass(submission.status)}>{submission.status.replace("_", " ")}</span>
          <div className="detail-score">Score {submission.score?.toFixed(2) ?? "—"}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Goal Breakdown</h3>
          <span className="panel-sub">Metrics and notes by goal.</span>
        </div>
        {goalSections.map((goal) => (
          <div key={goal.id} className="goal-section">
            <div className="goal-header">
              <div>
                <h4>{goal.name}</h4>
                {goal.description && <p>{goal.description}</p>}
              </div>
              <div className="goal-score">Score {goal.score?.toFixed(2) ?? "—"}</div>
            </div>
            {goal.note && <div className="goal-note-readonly">{goal.note}</div>}
            <div className="table">
              <div className="table-row table-header detail-table">
                <div>Metric</div>
                <div>Value</div>
              </div>
              {goal.metrics.map((row) => (
                <div key={row.id} className="table-row detail-table">
                  <div>{row.label}</div>
                  <div>{row.value ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {rawDeliveryData && (
        <div className="panel">
          <div className="panel-header">
            <h3>Raw Delivery Data</h3>
            <span className="panel-sub">
              Source: {rawDeliveryData.sheetName || "Raw Delivery Log"} ({rawDeliveryData.rows.length} row
              {rawDeliveryData.rows.length === 1 ? "" : "s"}) - Page {rawPage} of {rawTotalPages}
            </span>
          </div>
          <div className="raw-data-table-wrap">
            <table className="raw-data-table">
              <thead>
                <tr>
                  {rawDeliveryData.headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{header || `Column ${index + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawPageRows.map((row, rowIndex) => (
                  <tr key={`raw-row-${rawPageStart + rowIndex}`}>
                    {rawDeliveryData.headers.map((_, columnIndex) => (
                      <td key={`raw-cell-${rawPageStart + rowIndex}-${columnIndex}`}>
                        {(() => {
                          const value = row[columnIndex] || "-";
                          const explicitLink = String(rawPageLinks[rowIndex]?.[columnIndex] ?? "").trim();
                          const valueLink = resolveRawDataLink(value);
                          const href = explicitLink || valueLink;
                          if (!href) return value;
                          const linkLabel =
                            value === "-" || (explicitLink.length > 0 && Boolean(valueLink))
                              ? "Open Reference"
                              : value;
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="raw-data-link"
                              title={href}
                            >
                              {linkLabel}
                            </a>
                          );
                        })()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rawTotalPages > 1 && (
            <div className="raw-data-pagination">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRawPage((current) => Math.max(1, current - 1))}
                disabled={rawPage === 1}
              >
                Previous
              </button>
              <span>
                Showing {rawPageStart + 1}-
                {Math.min(rawPageStart + RAW_ROWS_PER_PAGE, rawDeliveryData.rows.length)} of{" "}
                {rawDeliveryData.rows.length}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRawPage((current) => Math.min(rawTotalPages, current + 1))}
                disabled={rawPage === rawTotalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h3>Review History</h3>
          <span className="panel-sub">Manager decisions and feedback.</span>
        </div>
        <div className="timeline">
          {(submission.reviews ?? []).map((review) => (
            <div key={review.id} className="timeline-item">
              <div>
                <div className="timeline-title">{review.status.replace("_", " ")}</div>
                <div className="timeline-sub">
                  {review.reviewer?.name ?? "Reviewer"} • {formatDateTime(review.reviewedAt)}
                </div>
              </div>
              <div className="timeline-note">{review.comment ?? "No comment"}</div>
            </div>
          ))}
          {submission.reviews?.length === 0 && <div className="empty-state">No reviews yet.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Comments</h3>
          <span className="panel-sub">Collaborate with feedback and clarifications.</span>
        </div>
        <div className="timeline">
          {(submission.comments ?? []).map((item) => (
            <div key={item.id} className="timeline-item">
              <div>
                <div className="timeline-title">{item.author.name}</div>
                <div className="timeline-sub">
                  {item.author.role} • {formatDateTime(item.createdAt)}
                </div>
              </div>
              <div className="timeline-note">{item.message}</div>
            </div>
          ))}
          {submission.comments?.length === 0 && <div className="empty-state">No comments yet.</div>}
        </div>

        <form
          className="form comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!comment.trim()) return;
            commentMutation.mutate(comment.trim());
          }}
        >
          <label className="form-field">
            <span>Add comment</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Write a note for this submission..."
              rows={3}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={commentMutation.isPending}>
            {commentMutation.isPending ? "Saving..." : "Add comment"}
          </button>
        </form>
      </div>

      {canReview && (
        <div className="panel">
          <div className="panel-header">
            <h3>Manager Review</h3>
            <span className="panel-sub">Approve, reject, or request changes.</span>
          </div>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              reviewMutation.mutate({
                status: reviewStatus,
                comment: reviewComment.trim() ? reviewComment.trim() : undefined,
              });
            }}
          >
            <div className="form-grid">
              <label className="form-field">
                <span>Status</span>
                <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as Review["status"])}>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="CHANGES_REQUESTED">CHANGES_REQUESTED</option>
                </select>
              </label>
              <label className="form-field">
                <span>Comment</span>
                <input
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Optional message"
                />
              </label>
            </div>
            <button className="btn btn-primary" type="submit" disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? "Submitting..." : "Submit review"}
            </button>
          </form>
        </div>
      )}

      {hasReviewRole && isOwnSubmission && (
        <div className="panel">
          <div className="panel-sub">Self-review is not allowed. Ask your manager or admin to review this KPI entry.</div>
        </div>
      )}

      {canReview && (
        <div className="panel">
          <div className="panel-header">
            <h3>Reports</h3>
            <span className="panel-sub">Generate and download PDF report on demand.</span>
          </div>
          <div className="report-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => reportMutation.mutate()}
              disabled={reportMutation.isPending}
            >
              {reportMutation.isPending ? "Generating..." : "Generate PDF"}
            </button>
          </div>
        </div>
      )}

      <Link className="btn btn-ghost" to={canReview ? "/team" : "/submissions"}>
        {canReview ? "Back to team submissions" : "Back to submissions"}
      </Link>
    </div>
  );
}
