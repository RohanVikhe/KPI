import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { Submission } from "../lib/types.ts";
import DateRangePicker from "../components/DateRangePicker.tsx";

const TEAM_SUBMISSIONS_PAGE_SIZE = 12;

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

function projectSummary(projects?: { name: string }[]) {
  if (!projects || projects.length === 0) return "--";
  const names = projects.map((project) => project.name);
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

type SortField = "submittedAt" | "periodEnd" | "employee" | "score" | "status";

export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["submissions", isAdmin ? "all" : "team"],
    queryFn: () => apiFetch<{ submissions: Submission[] }>(isAdmin ? "/submissions/all" : "/submissions/team"),
  });

  const submissions = data?.submissions ?? [];
  const userIdParam = searchParams.get("userId");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [userFilter, setUserFilter] = useState<string>(userIdParam ?? "ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortField, setSortField] = useState<SortField>("submittedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(submissions.map((item) => item.status))).sort();
    return ["ALL", ...statuses];
  }, [submissions]);

  const userOptions = useMemo(() => {
    const uniqueUsers = new Map<string, string>();
    submissions.forEach((submission) => {
      if (submission.user?.id && submission.user?.name) {
        uniqueUsers.set(submission.user.id, submission.user.name);
      }
    });

    return Array.from(uniqueUsers.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [submissions]);

  const userOptionsForSelect = useMemo(() => {
    if (userFilter === "ALL") {
      return userOptions;
    }
    if (userOptions.some((option) => option.id === userFilter)) {
      return userOptions;
    }
    return [{ id: userFilter, name: "Selected user" }, ...userOptions];
  }, [userOptions, userFilter]);

  useEffect(() => {
    const nextFilter = searchParams.get("userId") ?? "ALL";
    if (nextFilter !== userFilter) {
      setUserFilter(nextFilter);
    }
  }, [searchParams, userFilter]);

  const handleUserFilterChange = (value: string) => {
    setUserFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value === "ALL") {
      next.delete("userId");
    } else {
      next.set("userId", value);
    }
    setSearchParams(next, { replace: true });
  };

  const filteredSubmissions = useMemo(() => {
    const search = query.trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999Z`).getTime() : null;

    return submissions.filter((submission) => {
      if (statusFilter !== "ALL" && submission.status !== statusFilter) {
        return false;
      }
      if (userFilter !== "ALL" && submission.user?.id !== userFilter) {
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
        submission.user?.name ?? "",
        submission.template.name,
        submission.status.replace("_", " "),
        ...(submission.user?.projects?.map((project) => project.name) ?? []),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(search);
    });
  }, [submissions, query, statusFilter, userFilter, fromDate, toDate]);

  const sortedSubmissions = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return filteredSubmissions.slice().sort((a, b) => {
      const compareText = (left: string, right: string) =>
        left.localeCompare(right, undefined, { sensitivity: "base" });
      if (sortField === "employee") {
        return compareText(a.user?.name ?? "", b.user?.name ?? "") * direction;
      }
      if (sortField === "status") {
        return compareText(a.status, b.status) * direction;
      }
      if (sortField === "score") {
        return ((a.score ?? -1) - (b.score ?? -1)) * direction;
      }
      const dateA =
        sortField === "submittedAt"
          ? new Date(a.submittedAt ?? 0).getTime()
          : new Date(a.periodEnd).getTime();
      const dateB =
        sortField === "submittedAt"
          ? new Date(b.submittedAt ?? 0).getTime()
          : new Date(b.periodEnd).getTime();
      return (dateA - dateB) * direction;
    });
  }, [filteredSubmissions, sortField, sortDirection]);

  const focusedUserSubmissions = useMemo(
    () => (userFilter === "ALL" ? [] : submissions.filter((item) => item.user?.id === userFilter)),
    [submissions, userFilter]
  );

  const focusedUser = useMemo(
    () => (userFilter === "ALL" ? null : userOptions.find((option) => option.id === userFilter) ?? null),
    [userFilter, userOptions]
  );

  const focusedUserStats = useMemo(() => {
    if (!focusedUser || focusedUserSubmissions.length === 0) {
      return null;
    }
    const scoreValues = focusedUserSubmissions
      .map((item) => item.score)
      .filter((score): score is number => typeof score === "number");
    const averageScore =
      scoreValues.length > 0
        ? scoreValues.reduce((total, score) => total + score, 0) / scoreValues.length
        : null;
    const latestSubmission = focusedUserSubmissions
      .slice()
      .sort((a, b) => new Date(b.submittedAt ?? b.periodEnd).getTime() - new Date(a.submittedAt ?? a.periodEnd).getTime())[0];

    return {
      total: focusedUserSubmissions.length,
      averageScore,
      latestScore: latestSubmission?.score ?? null,
      latestStatus: latestSubmission?.status ?? null,
      latestSubmittedAt: latestSubmission?.submittedAt,
    };
  }, [focusedUser, focusedUserSubmissions]);

  const totalPages = Math.max(1, Math.ceil(sortedSubmissions.length / TEAM_SUBMISSIONS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * TEAM_SUBMISSIONS_PAGE_SIZE;
  const visibleSubmissions = useMemo(
    () => sortedSubmissions.slice(pageStart, pageStart + TEAM_SUBMISSIONS_PAGE_SIZE),
    [sortedSubmissions, pageStart]
  );

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, userFilter, fromDate, toDate, sortField, sortDirection]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (isLoading) {
    return <div className="panel">Loading team KPI data...</div>;
  }

  if (error) {
    return <div className="panel">Unable to load team KPI data.</div>;
  }

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-header">
          <h3>{isAdmin ? "All Submissions" : "Team Submissions"}</h3>
          <span className="panel-sub">
            {isAdmin ? "Monitor performance across the organization." : "Monitor performance across direct reports."}
          </span>
        </div>
        <div className="form-grid team-filter-grid">
          <label className="form-field">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Employee, template, or project"
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
            <span>Employee</span>
            <select value={userFilter} onChange={(event) => handleUserFilterChange(event.target.value)}>
              <option value="ALL">ALL</option>
              {userOptionsForSelect.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onChangeFrom={setFromDate}
            onChangeTo={setToDate}
          />
          <label className="form-field">
            <span>Sort by</span>
            <select value={sortField} onChange={(event) => setSortField(event.target.value as SortField)}>
              <option value="submittedAt">Submitted On</option>
              <option value="periodEnd">Period End</option>
              <option value="employee">Employee</option>
              <option value="score">Score</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label className="form-field">
            <span>Order</span>
            <select
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
        </div>
        <div className="table-actions">
          <span className="panel-sub">
            Showing{" "}
            {sortedSubmissions.length === 0
              ? 0
              : `${pageStart + 1}-${Math.min(pageStart + TEAM_SUBMISSIONS_PAGE_SIZE, sortedSubmissions.length)}`}{" "}
            of {sortedSubmissions.length} submission{sortedSubmissions.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("ALL");
              handleUserFilterChange("ALL");
              setFromDate("");
              setToDate("");
              setSortField("submittedAt");
              setSortDirection("desc");
            }}
          >
            Reset filters
          </button>
        </div>

        {focusedUser && focusedUserStats && (
          <div className="team-focus-grid">
            <div className="team-focus-card">
              <div className="users-stat-label">Focused Employee</div>
              <div className="users-stat-value">{focusedUser.name}</div>
              <div className="users-stat-label">Submissions: {focusedUserStats.total}</div>
            </div>
            <div className="team-focus-card">
              <div className="users-stat-label">Average Score</div>
              <div className="users-stat-value">
                {focusedUserStats.averageScore !== null ? focusedUserStats.averageScore.toFixed(2) : "--"}
              </div>
              <div className="users-stat-label">
                Latest score: {focusedUserStats.latestScore !== null ? focusedUserStats.latestScore.toFixed(2) : "--"}
              </div>
            </div>
            <div className="team-focus-card">
              <div className="users-stat-label">Latest Status</div>
              <div className="users-stat-value">
                {focusedUserStats.latestStatus ? focusedUserStats.latestStatus.replace("_", " ") : "--"}
              </div>
              <div className="users-stat-label">
                Last submitted: {formatDateTime(focusedUserStats.latestSubmittedAt)}
              </div>
            </div>
          </div>
        )}

        <div className="table">
          <div className="table-row table-header team-table">
            <div>Employee</div>
            <div>Projects</div>
            <div>Template</div>
            <div>Period</div>
            <div>Submitted On</div>
            <div>Score</div>
            <div>Status</div>
            <div>Action</div>
          </div>
          {visibleSubmissions.map((submission) => (
            <div key={submission.id} className="table-row team-table">
              <div>{submission.user?.name ?? "--"}</div>
              <div>{projectSummary(submission.user?.projects)}</div>
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
                  Review
                </Link>
              </div>
            </div>
          ))}
        </div>
        {submissions.length === 0 && <div className="empty-state">No team submissions yet.</div>}
        {submissions.length > 0 && sortedSubmissions.length === 0 && (
          <div className="empty-state">No submissions match current filters.</div>
        )}

        {sortedSubmissions.length > 0 && totalPages > 1 && (
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
