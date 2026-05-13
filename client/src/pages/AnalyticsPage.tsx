import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { Template } from "../lib/types.ts";
import DateRangePicker from "../components/DateRangePicker.tsx";

type UserAnalytics = {
  points: { date: string; score: number }[];
  rollingAverage: { date: string; value: number }[];
  summary: { total: number; lastScore: number; delta: number };
};

type TeamAnalytics = {
  ranking: { userId: string; name: string; averageScore: number; submissions: number }[];
  trend: { date: string; averageScore: number }[];
  summary: { totalEmployees: number; averageScore: number };
};

type TeamMetricTrend = {
  metric: {
    metricId: string;
    label: string;
    type: "NUMBER" | "PERCENT" | "CURRENCY";
    goalId: string;
    goalName: string;
    targetText?: string | null;
  };
  trend: { date: string; value: number }[];
};

type IssueTicket = {
  id: string;
  link?: string | null;
};

type TeamMemberAnalytics = UserAnalytics & {
  user: { id: string; name: string; email: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" };
  goalProgress: {
    goalId: string;
    key: string;
    name: string;
    averageScore: number;
    submissions: number;
    order: number;
  }[];
  goalMetricProgress: {
    goalId: string;
    key: string;
    name: string;
    order: number;
      metrics: {
        metricId: string;
        key: string;
        label: string;
        type: "NUMBER" | "PERCENT" | "CURRENCY";
        targetText?: string | null;
        averageValue: number;
        submissions: number;
        order: number;
        trend: { date: string; value: number }[];
      }[];
  }[];
  issueTicketsByMetricKey?: Record<string, IssueTicket[]>;
};

type GoalMetricProgressView = TeamMemberAnalytics["goalMetricProgress"][number];

type MemberMetricSnapshotRow = {
  goalId: string;
  goalName: string;
  goalOrder: number;
  metricId: string;
  key: string;
  label: string;
  type: "NUMBER" | "PERCENT" | "CURRENCY";
  targetText?: string | null;
  averageValue: number;
  submissions: number;
  order: number;
};

const ALL_TEAM_MEMBERS_ID = "all";

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

function buildAnalyticsDateQuery(fromDate: string, toDate: string) {
  const params = new URLSearchParams();
  if (fromDate) {
    params.set("from", fromDate);
  }
  if (toDate) {
    params.set("to", toDate);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function formatTrendDateLabel(value: string) {
  if (!value) return "";
  const date = /^\d{4}-\d{2}$/.test(value)
    ? new Date(`${value}-01T00:00:00.000Z`)
    : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    ...( /^\d{4}-\d{2}$/.test(value) ? { year: "numeric" as const } : { day: "numeric" as const }),
  }).format(date);
}

function toUtcMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function parseMonthStartFromDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function formatMetricAverage(value: number, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (!Number.isFinite(value)) return "--";
  if (type === "PERCENT") return `${value.toFixed(2)}%`;
  if (type === "CURRENCY") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return value.toFixed(2);
}

function getMetricProgressPercent(value: number, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (type !== "PERCENT" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

type TargetRange = {
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
  enforceMin?: boolean;
  enforceMax?: boolean;
};

type MetricTargetStatus = "in" | "out" | "unknown";

type SnapshotThresholdRule = {
  direction: "min" | "max";
  value: number;
};

type SnapshotVisualStatus = MetricTargetStatus | "warning";

const SNAPSHOT_THRESHOLD_BY_KEY: Record<string, SnapshotThresholdRule> = {
  additional_initiatives_delivered: { direction: "min", value: 1 },
  vc_additional_initiatives: { direction: "min", value: 1 },
  automation_adoption: { direction: "min", value: 1 },
  qp_automated_projects: { direction: "min", value: 1 },
  delivery_error_rework_rate: { direction: "max", value: 5 },
  qp_rework_count: { direction: "max", value: 5 },
};

const TEMPORARY_ZERO_WARNING_METRIC_KEYS = new Set([
  "schedule_adherence",
  "scope_change_control",
  "process_compliance_rate",
  "change_management_adherence",
]);

function parseTargetRange(
  targetText?: string | null,
  metricType?: "NUMBER" | "PERCENT" | "CURRENCY"
): TargetRange | null {
  if (!targetText) return null;
  const normalized = targetText.toLowerCase().replace(/,/g, " ").replace(/\u2013/g, "-");
  const numbers = normalized.match(/-?\d+(\.\d+)?/g)?.map((value) => Number(value)) ?? [];
  if (numbers.length === 0) return null;

  const hasRangeText = /(\d+(\.\d+)?)\s*-\s*(\d+(\.\d+)?)/.test(normalized) || normalized.includes(" range");
  const hasToText = /\bto\b/.test(normalized);
  const hasExplicitMax = /(<=|â‰¤|<|at most|no more than|max(imum)?|upper|not exceed)/.test(normalized);
  const hasExplicitMin = /(>=|â‰¥|>|at least|min(imum)?|not less than)/.test(normalized);
  const maxInclusive = normalized.includes("<=") || normalized.includes("â‰¤") || normalized.includes("at most") || normalized.includes("no more than");
  const maxExclusive = normalized.includes("<") && !normalized.includes("<=");
  const minInclusive = normalized.includes(">=") || normalized.includes("â‰¥") || normalized.includes("at least") || normalized.includes("not less than");
  const minExclusive = normalized.includes(">") && !normalized.includes(">=");
  const isPercent = metricType === "PERCENT" || normalized.includes("%");
  const rangeUpperBound = Math.max(...numbers);
  const shouldEnforceMaxForRange = !isPercent || hasExplicitMax || rangeUpperBound <= 90;

  if (numbers.length >= 2 && (hasRangeText || hasToText)) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return {
      min,
      max,
      minInclusive: true,
      maxInclusive: true,
      enforceMin: true,
      enforceMax: shouldEnforceMaxForRange,
    };
  }

  const range: TargetRange = {};
  if (hasExplicitMin || minInclusive || minExclusive) {
    range.min = numbers[0];
    range.minInclusive = minInclusive;
    range.enforceMin = true;
  }
  if (hasExplicitMax || maxInclusive || maxExclusive) {
    range.max = numbers[0];
    range.maxInclusive = maxInclusive;
    range.enforceMax = true;
  }

  if (range.min === undefined && range.max === undefined && numbers.length >= 2) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return {
      min,
      max,
      minInclusive: true,
      maxInclusive: true,
      enforceMin: true,
      enforceMax: shouldEnforceMaxForRange,
    };
  }

  if (range.min === undefined && range.max === undefined) {
    return null;
  }

  if (range.min !== undefined && range.enforceMin === undefined) {
    range.enforceMin = true;
  }
  if (range.max !== undefined && range.enforceMax === undefined) {
    range.enforceMax = true;
  }

  return range;
}

function getTargetStatus(value: number | null | undefined, range: TargetRange | null): MetricTargetStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  if (!range || (range.min === undefined && range.max === undefined)) return "unknown";

  if (range.enforceMin && range.min !== undefined) {
    if (value < range.min) return "out";
    if (value === range.min && range.minInclusive === false) return "out";
  }
  if (range.enforceMax && range.max !== undefined) {
    if (value > range.max) return "out";
    if (value === range.max && range.maxInclusive === false) return "out";
  }
  return "in";
}

function getThresholdStatus(metricKey: string, value: number | null | undefined): MetricTargetStatus | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const rule = SNAPSHOT_THRESHOLD_BY_KEY[metricKey];
  if (!rule) return null;
  if (rule.direction === "min") {
    return value < rule.value ? "out" : "in";
  }
  return value > rule.value ? "out" : "in";
}

function getSnapshotVisualStatus(
  metricKey: string,
  value: number | null | undefined,
  baseStatus: MetricTargetStatus | null | undefined
): SnapshotVisualStatus {
  if (
    value !== null &&
    value !== undefined &&
    !Number.isNaN(value) &&
    value === 0 &&
    TEMPORARY_ZERO_WARNING_METRIC_KEYS.has(metricKey)
  ) {
    return "warning";
  }
  return baseStatus ?? "unknown";
}

function getSnapshotStatusClass(status: SnapshotVisualStatus) {
  if (status === "in") return "is-in-range";
  if (status === "out") return "is-out-range";
  if (status === "warning") return "is-warning";
  return "";
}

function isReworkMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("rework");
}

function isAdditionalInitiativesMetricKey(metricKey: string) {
  return metricKey.toLowerCase().includes("additional_initiatives");
}

function isAiAdoptionMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("automation_adoption") || normalized.includes("qp_automated_projects");
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const canViewTeamAnalytics = user?.role === "MANAGER" || user?.role === "ADMIN";
  const [showPersonalSection, setShowPersonalSection] = useState(!canViewTeamAnalytics);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(ALL_TEAM_MEMBERS_ID);
  const [teamMetricGoalId, setTeamMetricGoalId] = useState("");
  const [teamMetricId, setTeamMetricId] = useState("");
  const [expandedSnapshotKeys, setExpandedSnapshotKeys] = useState<Set<string>>(new Set());
  const isDateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const analyticsDateQuery = useMemo(() => buildAnalyticsDateQuery(fromDate, toDate), [fromDate, toDate]);
  const activeDateRangeLabel = useMemo(() => {
    if (!fromDate && !toDate) {
      return "All time";
    }
    return `${fromDate || "..."} to ${toDate || "..."}`;
  }, [fromDate, toDate]);

  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ["analytics", "me", fromDate, toDate],
    queryFn: () => apiFetch<{ analytics: UserAnalytics }>(`/analytics/me${analyticsDateQuery}`),
    enabled: !isDateRangeInvalid,
  });

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["analytics", "team", fromDate, toDate],
    queryFn: () => apiFetch<{ analytics: TeamAnalytics }>(`/analytics/team${analyticsDateQuery}`),
    enabled: canViewTeamAnalytics && !isDateRangeInvalid,
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates", "analytics"],
    queryFn: () => apiFetch<{ templates: Template[] }>("/templates"),
    enabled: canViewTeamAnalytics,
  });

  const { data: teamMemberData, isLoading: memberLoading, error: memberError } = useQuery({
    queryKey: ["analytics", "team", "member", selectedMemberId, fromDate, toDate],
    queryFn: () =>
      apiFetch<{ analytics: TeamMemberAnalytics }>(`/analytics/team/member/${selectedMemberId}${analyticsDateQuery}`),
    enabled: canViewTeamAnalytics && Boolean(selectedMemberId) && !isDateRangeInvalid,
  });

  const userAnalytics = userData?.analytics;
  const teamAnalytics = teamData?.analytics;
  const teamMemberAnalytics = teamMemberData?.analytics;
  const templates = templatesData?.templates ?? [];
  const activeTemplate = useMemo(
    () => templates.find((template) => template.isActive) ?? templates[0] ?? null,
    [templates]
  );

  const teamMetricGoals = useMemo(() => {
    if (!activeTemplate) return [];
    return activeTemplate.goals
      .map((goal) => {
        const computedMetrics = goal.metrics.filter((metric) => metric.isComputed);
        const displayMetrics = computedMetrics.length > 0 ? computedMetrics : goal.metrics;
        return {
          goalId: goal.id,
          name: goal.name,
          order: goal.order ?? 0,
          metrics: displayMetrics
            .map((metric) => ({
              metricId: metric.id,
              label: metric.label,
              type: metric.type,
              order: metric.order ?? 0,
            }))
            .sort((a, b) => {
              if (a.order !== b.order) return a.order - b.order;
              return a.label.localeCompare(b.label);
            }),
        };
      })
      .filter((goal) => goal.metrics.length > 0)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
  }, [activeTemplate]);

  const selectedTeamMetricGoal = useMemo(() => {
    if (teamMetricGoals.length === 0) return null;
    return teamMetricGoals.find((goal) => goal.goalId === teamMetricGoalId) ?? teamMetricGoals[0];
  }, [teamMetricGoals, teamMetricGoalId]);
  const selectedTeamMetric = useMemo(() => {
    if (!selectedTeamMetricGoal || selectedTeamMetricGoal.metrics.length === 0) return null;
    return (
      selectedTeamMetricGoal.metrics.find((metric) => metric.metricId === teamMetricId) ??
      selectedTeamMetricGoal.metrics[0]
    );
  }, [selectedTeamMetricGoal, teamMetricId]);

  const filteredMembers = useMemo(() => {
    const allMembers = teamAnalytics?.ranking ?? [];
    return allMembers.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [teamAnalytics?.ranking]);
  const isAllTeamMembersView = selectedMemberId === ALL_TEAM_MEMBERS_ID || teamMemberAnalytics?.user.id === ALL_TEAM_MEMBERS_ID;
  const memberGoalMetricProgress = teamMemberAnalytics?.goalMetricProgress ?? [];
  const metricGoalProgress = useMemo<GoalMetricProgressView[]>(() => {
    return memberGoalMetricProgress
      .filter((goal) => goal.metrics.length > 0)
      .slice()
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
  }, [memberGoalMetricProgress]);
  const memberMetricSnapshotRows = useMemo<MemberMetricSnapshotRow[]>(() => {
    return metricGoalProgress.flatMap((goal) => {
      const sortedMetrics = goal.metrics.slice().sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label);
      });
      return sortedMetrics.map((metric) => ({
        goalId: goal.goalId,
        goalName: goal.name,
        goalOrder: goal.order,
        metricId: metric.metricId,
        key: metric.key,
        label: metric.label,
        type: metric.type,
        targetText: metric.targetText ?? null,
        averageValue: metric.averageValue,
        submissions: metric.submissions,
        order: metric.order,
      }));
    });
  }, [metricGoalProgress]);
  const memberMetricSnapshotGroups = useMemo(
    () =>
      memberMetricSnapshotRows.reduce<Array<{ goalId: string; goalName: string; rows: MemberMetricSnapshotRow[] }>>(
        (groups, row) => {
          const currentGroup = groups[groups.length - 1];
          if (currentGroup && currentGroup.goalId === row.goalId) {
            currentGroup.rows.push(row);
            return groups;
          }

          groups.push({
            goalId: row.goalId,
            goalName: row.goalName,
            rows: [row],
          });
          return groups;
        },
        []
      ),
    [memberMetricSnapshotRows]
  );
  const metricIssueTicketsByKey = useMemo(() => {
    const entries = teamMemberAnalytics?.issueTicketsByMetricKey ?? {};
    return new Map<string, IssueTicket[]>(Object.entries(entries));
  }, [teamMemberAnalytics?.issueTicketsByMetricKey]);

  useEffect(() => {
    setExpandedSnapshotKeys(new Set());
  }, [selectedMemberId, fromDate, toDate, memberMetricSnapshotRows.length]);

  const {
    data: teamMetricTrendData,
    isLoading: teamMetricTrendLoading,
    error: teamMetricTrendError,
  } = useQuery({
    queryKey: ["analytics", "team", "metric", teamMetricId, fromDate, toDate],
    queryFn: () =>
      apiFetch<{ metricTrend: TeamMetricTrend }>(`/analytics/team/metric/${teamMetricId}${analyticsDateQuery}`),
    enabled: canViewTeamAnalytics && Boolean(teamMetricId) && !isDateRangeInvalid,
  });
  const teamMetricTrend = teamMetricTrendData?.metricTrend;
  const teamMetricTrendPoints = teamMetricTrend?.trend ?? [];
  const displayTeamMetricTrendPoints = useMemo(() => {
    if (teamMetricTrendPoints.length !== 1 || (!fromDate && !toDate)) {
      return teamMetricTrendPoints;
    }

    const onlyPoint = teamMetricTrendPoints[0];
    if (!onlyPoint || typeof onlyPoint.value !== "number" || !Number.isFinite(onlyPoint.value)) {
      return teamMetricTrendPoints;
    }

    const startMonth = parseMonthStartFromDate(fromDate) ?? parseMonthKey(onlyPoint.date);
    const endMonth = parseMonthStartFromDate(toDate) ?? parseMonthKey(onlyPoint.date);
    if (!startMonth || !endMonth || startMonth > endMonth) {
      return teamMetricTrendPoints;
    }

    const filledPoints: { date: string; value: number }[] = [];
    for (let cursor = new Date(startMonth.getTime()); cursor <= endMonth; cursor = addUtcMonths(cursor, 1)) {
      filledPoints.push({
        date: toUtcMonthKey(cursor),
        value: onlyPoint.value,
      });
    }

    return filledPoints.length > 1 ? filledPoints : teamMetricTrendPoints;
  }, [fromDate, toDate, teamMetricTrendPoints]);
  const teamMetricLatestValue = useMemo(() => {
    for (let index = displayTeamMetricTrendPoints.length - 1; index >= 0; index -= 1) {
      const value = displayTeamMetricTrendPoints[index]?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }, [displayTeamMetricTrendPoints]);

  useEffect(() => {
    setShowPersonalSection(!canViewTeamAnalytics);
  }, [canViewTeamAnalytics]);

  useEffect(() => {
    if (!canViewTeamAnalytics) {
      setSelectedMemberId(ALL_TEAM_MEMBERS_ID);
      return;
    }
    if (selectedMemberId === ALL_TEAM_MEMBERS_ID) {
      return;
    }
    const allMembers = teamAnalytics?.ranking ?? [];
    if (!allMembers.some((member) => member.userId === selectedMemberId)) {
      setSelectedMemberId(ALL_TEAM_MEMBERS_ID);
    }
  }, [canViewTeamAnalytics, selectedMemberId, teamAnalytics?.ranking]);

  useEffect(() => {
    if (teamMetricGoals.length === 0) {
      if (teamMetricGoalId) {
        setTeamMetricGoalId("");
      }
      if (teamMetricId) {
        setTeamMetricId("");
      }
      return;
    }
    if (!teamMetricGoals.some((goal) => goal.goalId === teamMetricGoalId)) {
      setTeamMetricGoalId(teamMetricGoals[0].goalId);
    }
  }, [teamMetricGoals, teamMetricGoalId, teamMetricId]);
  useEffect(() => {
    if (!selectedTeamMetricGoal || selectedTeamMetricGoal.metrics.length === 0) {
      if (teamMetricId) {
        setTeamMetricId("");
      }
      return;
    }
    if (!selectedTeamMetricGoal.metrics.some((metric) => metric.metricId === teamMetricId)) {
      setTeamMetricId(selectedTeamMetricGoal.metrics[0].metricId);
    }
  }, [selectedTeamMetricGoal, teamMetricId]);

  const toggleSnapshotDetails = (metricKey: string) => {
    setExpandedSnapshotKeys((prev) => {
      const next = new Set(prev);
      if (next.has(metricKey)) {
        next.delete(metricKey);
      } else {
        next.add(metricKey);
      }
      return next;
    });
  };

  return (
    <div className="page">
      {canViewTeamAnalytics && (
        <div className="analytics-toggle-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowPersonalSection((current) => !current)}
          >
            {showPersonalSection ? "Hide My Analytics" : "Show My Analytics"}
          </button>
        </div>
      )}

      <div className="panel analytics-date-panel">
        <div className="panel-header">
          <h3>Analytics Filters</h3>
          <span className="panel-sub">Date range applies to personal, team, and focused-user insights</span>
        </div>
        <div className="form-grid team-filter-grid">
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onChangeFrom={setFromDate}
            onChangeTo={setToDate}
          />
          {canViewTeamAnalytics && (
            <>
              <label className="form-field">
                <span>Focus user</span>
                <select
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  disabled={filteredMembers.length === 0}
                >
                  <option value={ALL_TEAM_MEMBERS_ID}>All</option>
                  {filteredMembers.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="table-actions">
          <span className="panel-sub">Active range: {activeDateRangeLabel}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
          >
            Reset range
          </button>
        </div>
        {isDateRangeInvalid && <div className="form-error">Start date must be before or equal to end date.</div>}
      </div>

      {showPersonalSection &&
        (isDateRangeInvalid ? (
          <div className="panel empty-state">Select a valid date range to load personal analytics.</div>
        ) : (
          <>
            <div className="chart-grid">
              <div className="panel chart-card">
                <div className="panel-header">
                  <h3>Personal KPI Trend</h3>
                  <span className="panel-sub">Rolling average vs raw score</span>
                </div>
                <div className="chart">
                  {userLoading ? (
                    <div className="empty-state">Loading analytics...</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={userAnalytics?.points ?? []}>
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatChartValue(value)} />
                        <Area type="monotone" dataKey="score" stroke="#f29d38" fill="rgba(242, 157, 56, 0.25)" />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="#f29d38"
                          strokeWidth={2}
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="panel chart-card">
                <div className="panel-header">
                  <h3>Rolling Average</h3>
                  <span className="panel-sub">3-period smoothing</span>
                </div>
                <div className="chart">
                  {userLoading ? (
                    <div className="empty-state">Loading analytics...</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={userAnalytics?.rollingAverage ?? []}>
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatChartValue(value)} />
                        <Line type="monotone" dataKey="value" stroke="#44d9e6" strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </>
        ))}

      {canViewTeamAnalytics && (
        <div className="panel">
          <div className="panel-header">
            <h3>{user?.role === "ADMIN" ? "Organization Analytics" : "Team Analytics"}</h3>
            <span className="panel-sub">Track performance, filter users, and drill into individual progress.</span>
          </div>
          {isDateRangeInvalid ? (
            <div className="empty-state">Select a valid date range to load analytics.</div>
          ) : teamLoading ? (
            <div className="empty-state">Loading team analytics...</div>
          ) : !teamAnalytics || teamAnalytics.ranking.length === 0 ? (
            <div className="empty-state">No team analytics data available yet.</div>
          ) : (
            <div className="analytics-section">
              <div className="analytics-inline-meta">
                <span className="panel-sub">Members tracked: {teamAnalytics.summary.totalEmployees}</span>
              </div>

              <div className="panel chart-card">
                <div className="panel-header">
                  <h4>Team Metric Trend</h4>
                  <span className="panel-sub">
                    {selectedTeamMetric
                      ? `${selectedTeamMetric.label} · ${selectedTeamMetricGoal?.name ?? "Metric"}`
                      : "Select a metric to view the team trend"}
                  </span>
                </div>
                <div className="form-grid team-filter-grid">
                  <label className="form-field">
                    <span>Parent Goal</span>
                    <select
                      value={selectedTeamMetricGoal?.goalId ?? ""}
                      onChange={(event) => setTeamMetricGoalId(event.target.value)}
                      disabled={teamMetricGoals.length === 0}
                    >
                      {teamMetricGoals.map((goal) => (
                        <option key={`team-metric-goal-${goal.goalId}`} value={goal.goalId}>
                          {goal.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Metric</span>
                    <select
                      value={selectedTeamMetric?.metricId ?? ""}
                      onChange={(event) => setTeamMetricId(event.target.value)}
                      disabled={!selectedTeamMetricGoal || selectedTeamMetricGoal.metrics.length === 0}
                    >
                      {(selectedTeamMetricGoal?.metrics ?? []).map((metric) => (
                        <option key={`team-metric-${metric.metricId}`} value={metric.metricId}>
                          {metric.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="chart">
                  {teamMetricGoals.length === 0 ? (
                    <div className="empty-state">No team metrics available.</div>
                  ) : !selectedTeamMetric ? (
                    <div className="empty-state">Select a metric to view the team trend.</div>
                  ) : isDateRangeInvalid ? (
                    <div className="empty-state">Select a valid date range to load metrics.</div>
                  ) : teamMetricTrendLoading ? (
                    <div className="empty-state">Loading team metric trend...</div>
                  ) : teamMetricTrendError ? (
                    <div className="empty-state">Unable to load team metric trend.</div>
                  ) : displayTeamMetricTrendPoints.length === 0 ? (
                    <div className="empty-state">No metric trend data available.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={displayTeamMetricTrendPoints}>
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                          tickFormatter={formatTrendDateLabel}
                        />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip
                          labelFormatter={(label) => formatTrendDateLabel(String(label ?? ""))}
                          formatter={(value) => {
                            const parsed = typeof value === "number" ? value : Number(value);
                            if (!Number.isFinite(parsed)) return String(value ?? "");
                            const type = teamMetricTrend?.metric.type ?? "NUMBER";
                            return formatMetricAverage(parsed, type);
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#6bf0a1"
                          strokeWidth={3}
                          connectNulls={false}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {teamMetricTrend && teamMetricTrend.metric && selectedTeamMetric && (
                  <div className="metric-trend-summary">
                    <div className="metric-summary-item">
                      <div className="metric-summary-label">Latest</div>
                      <div className="metric-summary-value">
                        {teamMetricLatestValue === null
                          ? "--"
                          : formatMetricAverage(teamMetricLatestValue, teamMetricTrend.metric.type)}
                      </div>
                    </div>
                    <div className="metric-summary-item">
                      <div className="metric-summary-label">Target</div>
                      <div className="metric-summary-value">{teamMetricTrend.metric.targetText ?? "--"}</div>
                    </div>
                    <div className="metric-summary-item">
                      <div className="metric-summary-label">Range</div>
                      <div className="metric-summary-value">{activeDateRangeLabel}</div>
                    </div>
                  </div>
                )}
              </div>

              {selectedMemberId && (
                <div className="panel analytics-member-panel">
                  <div className="panel-header">
                    <h4>{isAllTeamMembersView ? "Team Progress Snapshot" : "Focused User Progress"}</h4>
                    {teamMemberAnalytics?.user ? (
                      <span className="panel-sub">
                        {isAllTeamMembersView
                          ? `${teamMemberAnalytics.user.name} (combined totals and computed metrics)`
                          : `${teamMemberAnalytics.user.name} (${teamMemberAnalytics.user.role})`}
                      </span>
                    ) : (
                      <span className="panel-sub">Member details</span>
                    )}
                  </div>
                  {memberLoading ? (
                    <div className="empty-state">Loading selected user progress...</div>
                  ) : memberError ? (
                    <div className="empty-state">Unable to load selected user analytics.</div>
                  ) : !teamMemberAnalytics ? (
                    <div className="empty-state">No data available for this user.</div>
                  ) : (
                    <div className="analytics-member-content">
                      <div className="table-actions">
                        <span className="panel-sub">
                          {isAllTeamMembersView ? activeDateRangeLabel : teamMemberAnalytics.user.email}
                        </span>
                        <Link
                          className="btn btn-ghost"
                          to={
                            isAllTeamMembersView
                              ? "/team"
                              : `/team?userId=${encodeURIComponent(teamMemberAnalytics.user.id)}`
                          }
                        >
                          {isAllTeamMembersView ? "View team submissions" : "View submissions"}
                        </Link>
                      </div>
                      {memberMetricSnapshotRows.length === 0 ? (
                        <div className="empty-state">
                          {isAllTeamMembersView
                            ? "No metrics available for the current team selection."
                            : "No metrics available for this user."}
                        </div>
                      ) : (
                        <div className="analytics-goal-detail-card">
                          <div className="panel-header">
                            <h4>Metric Snapshot</h4>
                            <span className="panel-sub">
                              {isAllTeamMembersView
                                ? `Combined team totals and computed metrics across: ${activeDateRangeLabel}`
                                : `Snapshot across the active range: ${activeDateRangeLabel}`}
                            </span>
                          </div>
                          <div className="analytics-goal-detail-table">
                            <div className="analytics-goal-detail-row analytics-goal-detail-row-header metric-snapshot-row">
                              <div>Metric</div>
                              <div>Target</div>
                              <div>Rate</div>
                            </div>
                            {memberMetricSnapshotGroups.map((group) => (
                              <Fragment key={`metric-snapshot-group-${group.goalId}`}>
                                <div className="metric-snapshot-group-header">
                                  <span className="metric-snapshot-group-title">{group.goalName}</span>
                                  <span className="metric-snapshot-group-meta">
                                    {group.rows.length} {group.rows.length === 1 ? "metric" : "metrics"}
                                  </span>
                                </div>
                                {group.rows.map((row) => {
                                  const progress = getMetricProgressPercent(row.averageValue, row.type);
                                  const rateValue =
                                    progress === null ? formatMetricAverage(row.averageValue, row.type) : null;
                                  const rateText = progress === null ? rateValue : `${progress.toFixed(2)}%`;
                                  const displayRateText = rateText ?? "--";
                                  const isRateMuted = displayRateText === "--";
                                  const targetRange = parseTargetRange(row.targetText ?? null, row.type);
                                  const targetStatus = getTargetStatus(row.averageValue, targetRange);
                                  const thresholdStatus = getThresholdStatus(row.key, row.averageValue);
                                  const visualStatus = getSnapshotVisualStatus(
                                    row.key,
                                    row.averageValue,
                                    thresholdStatus ?? targetStatus
                                  );
                                  const statusClass = getSnapshotStatusClass(visualStatus);
                                  const issueTickets = metricIssueTicketsByKey.get(row.key) ?? [];
                                  const isReworkMetric = isReworkMetricKey(row.key);
                                  const isAdditionalInitiativesMetric = isAdditionalInitiativesMetricKey(row.key);
                                  const isAiAdoptionMetric = isAiAdoptionMetricKey(row.key);
                                  const canShowIssues =
                                    visualStatus !== "warning" &&
                                    (targetStatus === "out" ||
                                      (isReworkMetric && issueTickets.length > 0) ||
                                      (isAdditionalInitiativesMetric && issueTickets.length > 0) ||
                                      (isAiAdoptionMetric && issueTickets.length > 0));
                                  const isExpanded = expandedSnapshotKeys.has(row.key);

                                  return (
                                    <Fragment key={`metric-snapshot-${row.goalId}-${row.metricId}`}>
                                      <div className={`analytics-goal-detail-row metric-snapshot-row ${statusClass}`}>
                                        <div className="metric-snapshot-label">
                                          <div className="metric-title-row">
                                            <span className="metric-title">{row.label}</span>
                                          </div>
                                        </div>
                                        <div className="metric-snapshot-target">
                                          <span className="metric-cell-label">Target</span>
                                          <span className="metric-cell-value">{row.targetText ?? "--"}</span>
                                        </div>
                                        <div className="metric-snapshot-progress">
                                          <div className="metric-rate-wrap">
                                            <div className="metric-rate-copy">
                                              <span className="metric-cell-label">Rate</span>
                                              <span
                                                className={isRateMuted ? "metric-summary-muted" : "metric-rate-value"}
                                              >
                                                {displayRateText}
                                              </span>
                                            </div>
                                            {canShowIssues && (
                                              <button
                                                type="button"
                                                className={`metric-issue-toggle ${isExpanded ? "is-open" : ""}`}
                                                onClick={() => toggleSnapshotDetails(row.key)}
                                                title={isExpanded ? "Hide tickets" : "View tickets"}
                                                aria-label={isExpanded ? "Hide tickets" : "View tickets"}
                                              >
                                                <svg viewBox="0 0 20 20" aria-hidden="true" className="metric-issue-icon">
                                                  <path
                                                    d="M3.5 6.5h13v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7Zm2-3h9a2 2 0 0 1 2 2v1h-13v-1a2 2 0 0 1 2-2Zm2 7h5"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="1.4"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  />
                                                </svg>
                                                <svg
                                                  viewBox="0 0 20 20"
                                                  aria-hidden="true"
                                                  className={`metric-issue-chevron ${isExpanded ? "is-open" : ""}`}
                                                >
                                                  <path
                                                    d="M6 8.5 10 12.5 14 8.5"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="1.6"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  />
                                                </svg>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      {canShowIssues && isExpanded && (
                                        <div className="analytics-goal-detail-row metric-snapshot-details">
                                          <div className="metric-snapshot-detail">
                                            <span className="metric-snapshot-detail-label">Tickets:</span>
                                            {issueTickets.length === 0 ? (
                                              <span className="metric-snapshot-empty">No ticket details available.</span>
                                            ) : (
                                              <div className="metric-snapshot-ticket-list">
                                                {issueTickets.map((ticket) =>
                                                  ticket.link ? (
                                                    <a
                                                      key={`${row.key}-${ticket.id}`}
                                                      href={ticket.link}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="metric-ticket-link"
                                                    >
                                                      {ticket.id}
                                                    </a>
                                                  ) : (
                                                    <span key={`${row.key}-${ticket.id}`} className="metric-ticket-text">
                                                      {ticket.id}
                                                    </span>
                                                  )
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
