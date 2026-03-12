import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { Project, Submission, User } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";

const COLORS = ["#f29d38", "#44d9e6", "#7c8cff", "#f468a5", "#6bf0a1"];
const ORG_ROWS_PER_PAGE = 12;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type ProjectCountFormState = {
  totalTickets: string;
  doneTickets: string;
  overdueTickets: string;
  changeRequestTickets: string;
};

type ProjectCountSnapshot = {
  total: number;
  done: number;
  overdue: number;
  changeRequests: number;
};

type DashboardUserProjects = Pick<User, "id" | "name" | "email" | "role" | "isActive"> & {
  projects?: Project[];
};

type MonthlyGoalScore = {
  goalId: string;
  key: string;
  name: string;
  score: number;
};

type MonthlySubmission = {
  monthKey: string;
  periodStart: string;
  periodEnd: string;
  score: number;
  goalScores: MonthlyGoalScore[];
  sourceSubmissions: number;
  latestTemplateName: string;
};

const emptyProjectCounts: ProjectCountFormState = {
  totalTickets: "0",
  doneTickets: "0",
  overdueTickets: "0",
  changeRequestTickets: "0",
};

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMonthLabel(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthKey;
  }
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function toUtcDateOnly(value: string) {
  const dayValue = value.slice(0, 10);
  const date = new Date(`${dayValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function utcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function utcMonthEnd(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function utcMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daySpanInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1;
}

function normalizeScore(score: number | null | undefined) {
  if (score === null || score === undefined || Number.isNaN(score)) return 0;
  const scaled = score >= 0 && score <= 1 ? score * 100 : score;
  if (scaled > 1 && scaled <= 5) {
    return Math.min(100, Math.max(0, (scaled / 5) * 100));
  }
  return Math.min(100, Math.max(0, scaled));
}

function formatChartValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
    return value;
  }
  return String(value ?? "");
}

function parseCount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function getProjectCounts(project: Project): ProjectCountSnapshot {
  if (project.ticketCounts) {
    return project.ticketCounts;
  }

  return { total: 0, done: 0, overdue: 0, changeRequests: 0 };
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const projectSectionRef = useRef<HTMLElement | null>(null);

  const canViewTeamProjects = user?.role === "MANAGER" || user?.role === "ADMIN";

  const { data, isLoading, error } = useQuery({
    queryKey: ["submissions", "me", "dashboard", "approved"],
    queryFn: () => apiFetch<{ submissions: Submission[] }>("/submissions/me?approvedOnly=true"),
  });
  const { data: projectsData } = useQuery({
    queryKey: ["projects", "me"],
    queryFn: () => apiFetch<{ projects: Project[] }>("/projects/me"),
  });
  const {
    data: teamUsersData,
    isLoading: isTeamUsersLoading,
    error: teamUsersError,
  } = useQuery({
    queryKey: ["dashboard", "team-projects", user?.role],
    enabled: canViewTeamProjects,
    queryFn: () =>
      apiFetch<{ users: DashboardUserProjects[] }>(
        user?.role === "ADMIN" ? "/users" : "/users/team"
      ),
  });

  const submissions = (data?.submissions ?? []).filter((submission) => submission.status === "APPROVED");
  const monthlySubmissions = useMemo(() => {
    type GoalAccumulator = {
      goalId: string;
      key: string;
      name: string;
      weightedTotal: number;
      totalDays: number;
    };

    type MonthAccumulator = {
      monthKey: string;
      coveredStart: Date;
      coveredEnd: Date;
      weightedScoreTotal: number;
      totalDays: number;
      goalById: Map<string, GoalAccumulator>;
      latestPeriodEndTs: number;
      latestTemplateName: string;
      sourceSubmissions: number;
    };

    const buckets = new Map<string, MonthAccumulator>();

    submissions.forEach((submission) => {
      const start = toUtcDateOnly(submission.periodStart);
      const end = toUtcDateOnly(submission.periodEnd);
      if (!start || !end || start > end) {
        return;
      }

      let cursor = new Date(start.getTime());
      while (cursor <= end) {
        const monthStart = utcMonthStart(cursor);
        const monthEnd = utcMonthEnd(cursor);
        const segmentStart = start > monthStart ? start : monthStart;
        const segmentEnd = end < monthEnd ? end : monthEnd;
        const daysCovered = daySpanInclusive(segmentStart, segmentEnd);

        if (daysCovered <= 0) {
          cursor = addUtcDays(monthEnd, 1);
          continue;
        }

        const key = utcMonthKey(monthStart);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            monthKey: key,
            coveredStart: segmentStart,
            coveredEnd: segmentEnd,
            weightedScoreTotal: 0,
            totalDays: 0,
            goalById: new Map<string, GoalAccumulator>(),
            latestPeriodEndTs: Number.NEGATIVE_INFINITY,
            latestTemplateName: "",
            sourceSubmissions: 0,
          };
          buckets.set(key, bucket);
        } else {
          if (segmentStart < bucket.coveredStart) {
            bucket.coveredStart = segmentStart;
          }
          if (segmentEnd > bucket.coveredEnd) {
            bucket.coveredEnd = segmentEnd;
          }
        }

        bucket.weightedScoreTotal += (submission.score ?? 0) * daysCovered;
        bucket.totalDays += daysCovered;
        bucket.sourceSubmissions += 1;

        const submissionPeriodEndTs = new Date(submission.periodEnd).getTime();
        if (Number.isFinite(submissionPeriodEndTs) && submissionPeriodEndTs >= bucket.latestPeriodEndTs) {
          bucket.latestPeriodEndTs = submissionPeriodEndTs;
          bucket.latestTemplateName = submission.template.name;
        }

        submission.goalScores?.forEach((goal) => {
          const goalScore = goal.score ?? 0;
          const existingGoal = bucket.goalById.get(goal.goalId);
          if (!existingGoal) {
            bucket.goalById.set(goal.goalId, {
              goalId: goal.goalId,
              key: goal.key,
              name: goal.name,
              weightedTotal: goalScore * daysCovered,
              totalDays: daysCovered,
            });
            return;
          }
          existingGoal.weightedTotal += goalScore * daysCovered;
          existingGoal.totalDays += daysCovered;
        });

        cursor = addUtcDays(monthEnd, 1);
      }
    });

    return Array.from(buckets.values())
      .map<MonthlySubmission>((bucket) => ({
        monthKey: bucket.monthKey,
        periodStart: bucket.coveredStart.toISOString(),
        periodEnd: bucket.coveredEnd.toISOString(),
        score: bucket.totalDays > 0 ? bucket.weightedScoreTotal / bucket.totalDays : 0,
        goalScores: Array.from(bucket.goalById.values()).map((goal) => ({
          goalId: goal.goalId,
          key: goal.key,
          name: goal.name,
          score: goal.totalDays > 0 ? goal.weightedTotal / goal.totalDays : 0,
        })),
        sourceSubmissions: bucket.sourceSubmissions,
        latestTemplateName: bucket.latestTemplateName || "Multiple templates",
      }))
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  }, [submissions]);

  const projects = projectsData?.projects ?? [];
  const latest = monthlySubmissions[0];
  const goalSource = useMemo(() => {
    const withMultipleGoals =
      submissions.find((item) => (item.goalScores?.length ?? 0) > 1) ??
      submissions.find((item) => (item.template.goals?.length ?? 0) > 1);
    return withMultipleGoals ?? submissions[0];
  }, [submissions]);
  const averagedGoalScores = useMemo(() => {
    const aggregate = new Map<
      string,
      {
        goalId: string;
        key: string;
        name: string;
        total: number;
        count: number;
      }
    >();
    const goalOrder = new Map<string, number>();

    monthlySubmissions.forEach((submission) => {
      submission.goalScores.forEach((goal, index) => {
        if (!goalOrder.has(goal.goalId)) {
          goalOrder.set(goal.goalId, index);
        }
        const current = aggregate.get(goal.goalId);
        const score = goal.score;
        if (!current) {
          aggregate.set(goal.goalId, {
            goalId: goal.goalId,
            key: goal.key,
            name: goal.name,
            total: score,
            count: 1,
          });
          return;
        }
        current.total += score;
        current.count += 1;
      });
    });

    return Array.from(aggregate.values())
      .map((item) => ({
        goalId: item.goalId,
        key: item.key,
        name: item.name,
        score: item.count > 0 ? item.total / item.count : 0,
      }))
      .sort((a, b) => (goalOrder.get(a.goalId) ?? 0) - (goalOrder.get(b.goalId) ?? 0));
  }, [monthlySubmissions]);

  const stats = useMemo(() => {
    if (monthlySubmissions.length === 0) {
      return { avgScore: 0, bestScore: 0 };
    }
    const scores = monthlySubmissions.map((item) => item.score);
    const avgScore = scores.reduce((acc, cur) => acc + cur, 0) / scores.length;
    const bestScore = Math.max(...scores);
    return { avgScore, bestScore };
  }, [monthlySubmissions]);

  const trendData = useMemo(() => {
    return monthlySubmissions
      .slice()
      .reverse()
      .map((item) => ({
        date: formatMonthLabel(item.monthKey),
        score: item.score,
      }));
  }, [monthlySubmissions]);

  const pieData = useMemo(() => {
    if (averagedGoalScores.length > 0) {
      return averagedGoalScores
        .map((goal) => ({
          name: goal.name,
          value: goal.score ?? 0,
        }))
        .filter((item) => item.value > 0);
    }
    if (!goalSource) return [];
    if (goalSource.goalScores && goalSource.goalScores.length > 0) {
      return goalSource.goalScores
        .map((goal) => ({
          name: goal.name,
          value: goal.score ?? 0,
        }))
        .filter((item) => item.value > 0);
    }
    const valueMap = new Map(goalSource.values.map((value) => [value.metricId, value.valueNumber]));
    const metrics = goalSource.template.goals.flatMap((goal) => goal.metrics);
    return metrics
      .map((metric) => ({
        name: metric.label,
        value: valueMap.get(metric.id) ?? 0,
      }))
      .filter((item) => item.value > 0);
  }, [averagedGoalScores, goalSource]);

  const goalProgress = useMemo(() => {
    if (averagedGoalScores.length > 0) {
      return averagedGoalScores.map((goal) => ({
        ...goal,
        progress: normalizeScore(goal.score),
      }));
    }
    if (!goalSource?.goalScores) return [];
    return goalSource.goalScores.map((goal) => ({
      ...goal,
      progress: normalizeScore(goal.score),
    }));
  }, [averagedGoalScores, goalSource]);

  const goalOverallScore = averagedGoalScores.length > 0 ? stats.avgScore : (goalSource?.score ?? 0);

  const activeProjects = useMemo(() => projects.filter((project) => project.isActive), [projects]);

  const [showActiveProjectsOnly, setShowActiveProjectsOnly] = useState(false);
  const visibleProjects = useMemo(
    () => (showActiveProjectsOnly ? activeProjects : projects),
    [showActiveProjectsOnly, activeProjects, projects]
  );

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectCounts, setProjectCounts] = useState<ProjectCountFormState>(emptyProjectCounts);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [orgPage, setOrgPage] = useState(1);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const resetProjectForm = () => {
    setProjectName("");
    setProjectDescription("");
    setProjectCounts(emptyProjectCounts);
    setEditingProjectId(null);
  };

  const createProjectMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      description?: string | null;
      totalTickets: number;
      doneTickets: number;
      overdueTickets: number;
      changeRequestTickets: number;
    }) =>
      apiFetch<{ project: Project }>("/projects/me", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      resetProjectForm();
      showToast("success", "Project saved.");
      queryClient.invalidateQueries({ queryKey: ["projects", "me"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "team-projects"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to save project.";
      showToast("error", message);
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      name: string;
      description?: string | null;
      totalTickets: number;
      doneTickets: number;
      overdueTickets: number;
      changeRequestTickets: number;
    }) =>
      apiFetch<{ project: Project }>(`/projects/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          totalTickets: payload.totalTickets,
          doneTickets: payload.doneTickets,
          overdueTickets: payload.overdueTickets,
          changeRequestTickets: payload.changeRequestTickets,
        }),
      }),
    onSuccess: () => {
      resetProjectForm();
      showToast("success", "Project updated.");
      queryClient.invalidateQueries({ queryKey: ["projects", "me"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "team-projects"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to update project.";
      showToast("error", message);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch<{ project: Project }>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      showToast("success", "Project status updated.");
      queryClient.invalidateQueries({ queryKey: ["projects", "me"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "team-projects"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to update project status.";
      showToast("error", message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/projects/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      showToast("success", "Project removed.");
      queryClient.invalidateQueries({ queryKey: ["projects", "me"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "team-projects"] });
    },
    onError: (err: any) => {
      const message = err?.message ?? "Unable to remove project.";
      showToast("error", message);
    },
  });

  const handleProjectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectName.trim()) {
      const message = "Project name is required.";
      showToast("error", message);
      return;
    }

    const payload = {
      name: projectName.trim(),
      description: projectDescription.trim() ? projectDescription.trim() : null,
      totalTickets: parseCount(projectCounts.totalTickets),
      doneTickets: parseCount(projectCounts.doneTickets),
      overdueTickets: parseCount(projectCounts.overdueTickets),
      changeRequestTickets: parseCount(projectCounts.changeRequestTickets),
    };

    if (editingProjectId) {
      updateProjectMutation.mutate({
        id: editingProjectId,
        ...payload,
      });
      return;
    }

    createProjectMutation.mutate(payload);
  };

  const beginEditProject = (project: Project) => {
    const counts = getProjectCounts(project);
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setProjectDescription(project.description ?? "");
    setProjectCounts({
      totalTickets: String(counts.total),
      doneTickets: String(counts.done),
      overdueTickets: String(counts.overdue),
      changeRequestTickets: String(counts.changeRequests),
    });
  };

  const showActiveProjectsFromCard = () => {
    setShowActiveProjectsOnly(true);
    if (projectSectionRef.current) {
      projectSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const isSavingProject = createProjectMutation.isPending || updateProjectMutation.isPending;
  const teamUsers = teamUsersData?.users ?? [];
  const sortedTeamUsers = useMemo(
    () => [...teamUsers].sort((a, b) => a.name.localeCompare(b.name)),
    [teamUsers]
  );
  const teamSummary = useMemo(() => {
    const totals = {
      members: teamUsers.length,
      activeMembers: 0,
      activeProjects: 0,
      totalTickets: 0,
      doneTickets: 0,
      overdueTickets: 0,
      changeRequests: 0,
    };

    for (const member of teamUsers) {
      if (member.isActive) totals.activeMembers += 1;
      const memberProjects = (member.projects ?? []).filter((project) => project.isActive);
      totals.activeProjects += memberProjects.length;

      for (const project of memberProjects) {
        const counts = getProjectCounts(project);
        totals.totalTickets += counts.total;
        totals.doneTickets += counts.done;
        totals.overdueTickets += counts.overdue;
        totals.changeRequests += counts.changeRequests;
      }
    }

    const completionRate =
      totals.totalTickets > 0
        ? (totals.doneTickets / totals.totalTickets) * 100
        : 0;

    return { ...totals, completionRate };
  }, [teamUsers]);

  const teamProjectRows = useMemo(() => {
    return sortedTeamUsers.flatMap((member) => {
      const memberProjects = (member.projects ?? []).filter((project) => project.isActive);

      return memberProjects.map((project) => {
        const counts = getProjectCounts(project);
        const completion = counts.total > 0 ? (counts.done / counts.total) * 100 : 0;

        return {
          id: `${member.id}-${project.id}`,
          userName: member.name,
          projectName: project.name,
          projectDescription: project.description ?? "",
          total: counts.total,
          done: counts.done,
          overdue: counts.overdue,
          changeRequests: counts.changeRequests,
          completion,
        };
      });
    });
  }, [sortedTeamUsers]);

  const projectThroughputRows = useMemo(() => {
    const byProject = new Map<
      string,
      {
        projectName: string;
        total: number;
        done: number;
        overdue: number;
        changeRequests: number;
        contributors: Set<string>;
      }
    >();

    for (const row of teamProjectRows) {
      const key = row.projectName.trim().toLowerCase();
      const existing =
        byProject.get(key) ??
        {
          projectName: row.projectName,
          total: 0,
          done: 0,
          overdue: 0,
          changeRequests: 0,
          contributors: new Set<string>(),
        };

      existing.total += row.total;
      existing.done += row.done;
      existing.overdue += row.overdue;
      existing.changeRequests += row.changeRequests;
      existing.contributors.add(row.userName);
      byProject.set(key, existing);
    }

    return Array.from(byProject.values())
      .map((item) => ({
        ...item,
        contributorCount: item.contributors.size,
        completion: item.total > 0 ? (item.done / item.total) * 100 : 0,
      }))
      .sort((a, b) => {
        if (b.completion !== a.completion) return b.completion - a.completion;
        if (b.total !== a.total) return b.total - a.total;
        return a.projectName.localeCompare(b.projectName);
      });
  }, [teamProjectRows]);

  const usersWithoutActiveProjects = useMemo(
    () =>
      sortedTeamUsers.filter(
        (member) => (member.projects ?? []).filter((project) => project.isActive).length === 0
      ).length,
    [sortedTeamUsers]
  );
  const totalOrgPages = Math.max(1, Math.ceil(teamProjectRows.length / ORG_ROWS_PER_PAGE));
  const currentOrgPage = Math.min(orgPage, totalOrgPages);
  const visibleOrgRows = useMemo(() => {
    const start = (currentOrgPage - 1) * ORG_ROWS_PER_PAGE;
    return teamProjectRows.slice(start, start + ORG_ROWS_PER_PAGE);
  }, [teamProjectRows, currentOrgPage]);

  useEffect(() => {
    setOrgPage(1);
  }, [teamProjectRows.length]);

  if (isLoading) {
    return <div className="panel">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="panel">Unable to load your KPI data.</div>;
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
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Average KPI</div>
          <div className="stat-value">{stats.avgScore.toFixed(2)}</div>
          <div className="stat-sub">Across monthly periods</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Best KPI</div>
          <div className="stat-value">{stats.bestScore.toFixed(2)}</div>
          <div className="stat-sub">Personal top performance</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Latest Period</div>
          <div className="stat-value">{latest ? formatMonthLabel(latest.monthKey) : "--"}</div>
          <div className="stat-sub">{latest ? latest.latestTemplateName : "No submissions yet"}</div>
        </div>
        <button type="button" className="stat-card stat-card-button" onClick={showActiveProjectsFromCard}>
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{activeProjects.length}</div>
          <div className="stat-sub">Click to open your active projects</div>
        </button>
      </section>

      {monthlySubmissions.length === 0 ? (
        <div className="panel empty-state">
          <h3>No KPI submissions yet</h3>
          <p>Your dashboard updates only after manager or admin approval.</p>
        </div>
      ) : (
        <section className="chart-grid">
          <div className="panel chart-card">
            <div className="panel-header">
              <h3>KPI Trend</h3>
              <span className="panel-sub">Score movement across months</span>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => formatChartValue(value)} />
                  <Line type="monotone" dataKey="score" stroke="#f29d38" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel chart-card">
            <div className="panel-header">
              <h3>Goal Progress</h3>
              <span className="panel-sub">
                {averagedGoalScores.length > 0
                  ? `Goal-wise score average across ${monthlySubmissions.length} month${
                      monthlySubmissions.length === 1 ? "" : "s"
                    }`
                  : `Goal-wise score snapshot${goalSource?.periodEnd ? ` | ${formatDate(goalSource.periodEnd)}` : ""}`}
              </span>
            </div>
            <div className="chart">
              <div className="progress-stack">
                <div className="progress-row overall">
                  <div className="progress-label">Overall Score</div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${normalizeScore(goalOverallScore)}%` }} />
                  </div>
                  <div className="progress-value">{normalizeScore(goalOverallScore).toFixed(0)}%</div>
                </div>
                {goalProgress.map((goal, index) => (
                  <div key={goal.goalId} className="progress-row">
                    <div className="progress-label">{goal.name}</div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${goal.progress}%`, background: COLORS[index % COLORS.length] }}
                      />
                    </div>
                    <div className="progress-value">{goal.progress.toFixed(0)}%</div>
                  </div>
                ))}
                {goalProgress.length === 0 && (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatChartValue(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="panel project-panel" ref={projectSectionRef}>
        <div className="panel-header">
          <h3>My Projects</h3>
          <div className="table-actions">
            <span className="panel-sub">
              {showActiveProjectsOnly
                ? `Showing active projects (${visibleProjects.length})`
                : `All projects (${visibleProjects.length})`}
            </span>
            {showActiveProjectsOnly && (
              <button type="button" className="btn btn-ghost" onClick={() => setShowActiveProjectsOnly(false)}>
                Show all
              </button>
            )}
          </div>
        </div>
        <div className="project-list">
          {visibleProjects.map((project) => {
            const counts = getProjectCounts(project);

            return (
              <div key={project.id} className="project-item">
                <div>
                  <div className="project-name">{project.name}</div>
                  {project.description && <div className="project-desc">{project.description}</div>}
                  <div className="project-metrics">
                    <span>Total: {counts.total}</span>
                    <span>Done: {counts.done}</span>
                    <span>Overdue: {counts.overdue}</span>
                    <span>Change req: {counts.changeRequests}</span>
                  </div>
                </div>
                <div className="project-actions">
                  <span className="status-pill">{project.isActive ? "Active" : "Inactive"}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => beginEditProject(project)}
                    disabled={isSavingProject}
                  >
                    Edit counts
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => statusMutation.mutate({ id: project.id, isActive: !project.isActive })}
                    disabled={statusMutation.isPending}
                  >
                    {project.isActive ? "Archive" : "Activate"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (!window.confirm("Remove this project?")) return;
                      deleteMutation.mutate(project.id);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {visibleProjects.length === 0 && <div className="empty-state">No projects found for this view.</div>}
        </div>

        <form className="project-form" onSubmit={handleProjectSubmit}>
          <div className="project-form-grid">
            <label className="form-field">
              <span>Project name</span>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="NGC"
              />
            </label>
            <label className="form-field">
              <span>Description (optional)</span>
              <input
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="Client, role, or brief note"
              />
            </label>
            <label className="form-field">
              <span>Total tickets</span>
              <input
                type="number"
                min={0}
                value={projectCounts.totalTickets}
                onChange={(event) =>
                  setProjectCounts((prev) => ({ ...prev, totalTickets: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Done</span>
              <input
                type="number"
                min={0}
                value={projectCounts.doneTickets}
                onChange={(event) =>
                  setProjectCounts((prev) => ({ ...prev, doneTickets: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Overdue</span>
              <input
                type="number"
                min={0}
                value={projectCounts.overdueTickets}
                onChange={(event) =>
                  setProjectCounts((prev) => ({ ...prev, overdueTickets: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>Change requests</span>
              <input
                type="number"
                min={0}
                value={projectCounts.changeRequestTickets}
                onChange={(event) =>
                  setProjectCounts((prev) => ({ ...prev, changeRequestTickets: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={isSavingProject}>
              {editingProjectId
                ? isSavingProject
                  ? "Updating..."
                  : "Update project"
                : isSavingProject
                  ? "Saving..."
                  : "Add project"}
            </button>
            {editingProjectId && (
              <button type="button" className="btn btn-ghost" onClick={resetProjectForm} disabled={isSavingProject}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {canViewTeamProjects && (
        <section className="panel">
          <div className="panel-header">
            <h3>{user?.role === "ADMIN" ? "Organization Project Details" : "Team Project Details"}</h3>
            <span className="panel-sub">
              {user?.role === "ADMIN"
                ? "Admin view: all users and their active project counts."
                : "Manager view: your team members and their active project counts."}
            </span>
          </div>

          {isTeamUsersLoading ? (
            <div className="empty-state">Loading team project details...</div>
          ) : teamUsersError ? (
            <div className="empty-state">Unable to load team project details.</div>
          ) : sortedTeamUsers.length === 0 ? (
            <div className="empty-state">No team users found.</div>
          ) : (
            <div className="org-section">
              <div className="org-summary-grid">
                <div className="org-summary-card">
                  <div className="org-summary-label">Team Members</div>
                  <div className="org-summary-value">{teamSummary.members}</div>
                  <div className="org-summary-sub">
                    Active users: {teamSummary.activeMembers}
                  </div>
                </div>
                <div className="org-summary-card">
                  <div className="org-summary-label">Active Projects</div>
                  <div className="org-summary-value">{teamSummary.activeProjects}</div>
                  <div className="org-summary-sub">Across all visible users</div>
                </div>
                <div className="org-summary-card">
                  <div className="org-summary-label">Overall Ticket Throughput</div>
                  <div className="org-summary-value">
                    {teamSummary.doneTickets}/{teamSummary.totalTickets}
                  </div>
                  <div className="org-summary-sub">
                    Across all active projects: {teamSummary.completionRate.toFixed(1)}%
                  </div>
                </div>
                <div className="org-summary-card">
                  <div className="org-summary-label">Risk Indicators</div>
                  <div className="org-summary-value">{teamSummary.overdueTickets}</div>
                  <div className="org-summary-sub">
                    Overdue | Change req: {teamSummary.changeRequests}
                  </div>
                </div>
              </div>

              <div className="org-throughput-wrap">
                <div className="org-table-meta">
                  <span>Project-wise Ticket Throughput</span>
                  <span>Projects: {projectThroughputRows.length}</span>
                </div>
                {projectThroughputRows.length === 0 ? (
                  <div className="empty-state">No project throughput data available.</div>
                ) : (
                  <div className="org-throughput-table">
                    <div className="org-throughput-row org-throughput-row-header">
                      <div className="org-table-cell">Project</div>
                      <div className="org-table-cell">Contributors</div>
                      <div className="org-table-cell">Total</div>
                      <div className="org-table-cell">Done</div>
                      <div className="org-table-cell">Overdue</div>
                      <div className="org-table-cell">Change Req</div>
                      <div className="org-table-cell">Completion</div>
                    </div>
                    {projectThroughputRows.map((row) => (
                      <div key={row.projectName} className="org-throughput-row">
                        <div className="org-table-cell">
                          <div className="project-name">{row.projectName}</div>
                        </div>
                        <div className="org-table-cell" title={Array.from(row.contributors).join(", ")}>
                          {row.contributorCount}
                        </div>
                        <div className="org-table-cell">{row.total}</div>
                        <div className="org-table-cell">{row.done}</div>
                        <div className="org-table-cell">{row.overdue}</div>
                        <div className="org-table-cell">{row.changeRequests}</div>
                        <div className="org-table-cell">{row.completion.toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="org-table-meta">
                <span>Project rows: {teamProjectRows.length}</span>
                <span>Users without active projects: {usersWithoutActiveProjects}</span>
              </div>

              {teamProjectRows.length === 0 ? (
                <div className="empty-state">No active projects assigned.</div>
              ) : (
                <>
                  <div className="org-table-wrap">
                    <div className="org-table">
                      <div className="org-table-row org-table-row-header">
                        <div className="org-table-cell">User</div>
                        <div className="org-table-cell">Project</div>
                        <div className="org-table-cell">Total</div>
                        <div className="org-table-cell">Done</div>
                        <div className="org-table-cell">Overdue</div>
                        <div className="org-table-cell">Change Req</div>
                        <div className="org-table-cell">Completion</div>
                      </div>
                      {visibleOrgRows.map((row) => (
                        <div key={row.id} className="org-table-row">
                          <div className="org-table-cell">
                            <div className="team-project-name">{row.userName}</div>
                          </div>
                          <div className="org-table-cell">
                            <div className="project-name">{row.projectName}</div>
                            {row.projectDescription && (
                              <div className="project-desc">{row.projectDescription}</div>
                            )}
                          </div>
                          <div className="org-table-cell">{row.total}</div>
                          <div className="org-table-cell">{row.done}</div>
                          <div className="org-table-cell">{row.overdue}</div>
                          <div className="org-table-cell">{row.changeRequests}</div>
                          <div className="org-table-cell">{row.completion.toFixed(0)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {totalOrgPages > 1 && (
                    <div className="org-pagination">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setOrgPage((page) => Math.max(1, page - 1))}
                        disabled={currentOrgPage <= 1}
                      >
                        Previous
                      </button>
                      <span className="panel-sub">
                        Page {currentOrgPage} of {totalOrgPages}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setOrgPage((page) => Math.min(totalOrgPages, page + 1))}
                        disabled={currentOrgPage >= totalOrgPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
