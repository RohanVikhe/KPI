import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.ts";
import type { Submission } from "../lib/types.ts";

const SUBMISSIONS_PAGE_SIZE = 12;

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusClass(status: string) {
  return `status-pill status-${status.toLowerCase()}`;
}

export default function SubmissionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["submissions", "me"],
    queryFn: () => apiFetch<{ submissions: Submission[] }>("/submissions/me"),
  });

  const submissions = data?.submissions ?? [];
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(submissions.map((item) => item.status))).sort();
    return ["ALL", ...statuses];
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    const search = query.trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999Z`).getTime() : null;

    return submissions.filter((submission) => {
      if (statusFilter !== "ALL" && submission.status !== statusFilter) {
        return false;
      }

      const periodStartTs = new Date(submission.periodStart).getTime();
      const periodEndTs = new Date(submission.periodEnd).getTime();
      if (fromTs !== null && periodEndTs < fromTs) {
        return false;
      }
      if (toTs !== null && periodStartTs > toTs) {
        return false;
      }

      if (!search) {
        return true;
      }

      const searchable = [
        submission.template.name,
        submission.status.replace("_", " "),
        formatDate(submission.periodStart),
        formatDate(submission.periodEnd),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(search);
    });
  }, [submissions, query, statusFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filteredSubmissions.length / SUBMISSIONS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * SUBMISSIONS_PAGE_SIZE;
  const visibleSubmissions = useMemo(
    () => filteredSubmissions.slice(pageStart, pageStart + SUBMISSIONS_PAGE_SIZE),
    [filteredSubmissions, pageStart]
  );

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, fromDate, toDate]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (isLoading) {
    return <div className="panel">Loading submissions...</div>;
  }

  if (error) {
    return <div className="panel">Unable to load submissions.</div>;
  }

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-header">
          <h3>My Submissions</h3>
          <span className="panel-sub">Review all KPI entries and statuses.</span>
        </div>

        <div className="form-grid team-filter-grid">
          <label className="form-field">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Template, period, or status"
            />
          </label>
          <label className="form-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === "ALL" ? "ALL" : status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>To</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
        </div>

        <div className="table-actions">
          <span className="panel-sub">
            Showing{" "}
            {filteredSubmissions.length === 0
              ? 0
              : `${pageStart + 1}-${Math.min(pageStart + SUBMISSIONS_PAGE_SIZE, filteredSubmissions.length)}`}{" "}
            of {filteredSubmissions.length} submission{filteredSubmissions.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("ALL");
              setFromDate("");
              setToDate("");
            }}
          >
            Reset filters
          </button>
        </div>

        <div className="table">
          <div className="table-row table-header submissions-table">
            <div>Template</div>
            <div>Period</div>
            <div>Submitted On</div>
            <div>Score</div>
            <div>Status</div>
            <div>Action</div>
          </div>
          {visibleSubmissions.map((submission) => (
            <div key={submission.id} className="table-row submissions-table">
              <div>{submission.template.name}</div>
              <div>
                {formatDate(submission.periodStart)} - {formatDate(submission.periodEnd)}
              </div>
              <div>{formatDateTime(submission.submittedAt)}</div>
              <div>{submission.score?.toFixed(2) ?? "--"}</div>
              <div>
                <span className={statusClass(submission.status)}>{submission.status.replace("_", " ")}</span>
              </div>
              <div>
                <Link className="btn btn-ghost" to={`/submissions/${submission.id}`}>
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>

        {submissions.length === 0 && <div className="empty-state">No submissions yet.</div>}
        {submissions.length > 0 && filteredSubmissions.length === 0 && (
          <div className="empty-state">No submissions match current filters.</div>
        )}

        {filteredSubmissions.length > 0 && totalPages > 1 && (
          <div className="table-pagination">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span className="panel-sub">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
