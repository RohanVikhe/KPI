import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../lib/api.ts";
import { parseFlexibleDateString } from "../lib/date.ts";
import { evaluateFormula } from "../lib/formula.ts";
import { useAuth } from "../lib/auth.tsx";
import type { Project, Submission, User } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";
import DateRangePicker from "../components/DateRangePicker.tsx";

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

type MetricSeriesPoint = {
  monthKey: string;
  value: number;
};

type MetricSeries = {
  key: string;
  label: string;
  type: "NUMBER" | "PERCENT" | "CURRENCY";
  goalKey: string;
  goalName: string;
  order: number;
  metricOrder: number;
  targetText?: string | null;
  points: MetricSeriesPoint[];
};

type MetricSnapshotRow = MetricSeries & {
  rangeValue: number | null;
};

type TargetRange = {
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
  enforceMin?: boolean;
  enforceMax?: boolean;
};

type MetricTargetStatus = "in" | "out" | "unknown";

type IssueTicket = {
  id: string;
  link?: string | null;
};

type RawIssueType = "escalation" | "postDefect" | "rework" | "late" | "notFtr" | "aiAdoption" | "scopeChange";

type RawIssueColumns = {
  ticketId: number;
  deliveryDate: number;
  dueDate: number;
  workType: number;
  reworkFlag: number;
  reworkCount: number;
  escalationFlag: number;
  escalationLevel: number;
  postDefectFlag: number;
  postDefectCount: number;
  ftrFlag: number;
  scopeChange: number;
};

type MetricAggregate = {
  weightedTotal: number;
  totalDays: number;
};

const emptyProjectCounts: ProjectCountFormState = {
  totalTickets: "0",
  doneTickets: "0",
  overdueTickets: "0",
  changeRequestTickets: "0",
};

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

function formatMetricValue(value: number | null | undefined, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (type === "PERCENT") {
    return `${value.toFixed(2)}%`;
  }
  if (type === "CURRENCY") {
    return value.toFixed(2);
  }
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function getMetricProgressPercent(value: number | null | undefined, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (type !== "PERCENT" || value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function shouldUsePerPeriodTarget(targetText?: string | null) {
  if (!targetText) return false;
  const normalized = targetText.toLowerCase();
  return normalized.includes("per measurement period") || normalized.includes("per period");
}

const PER_PERIOD_SKIP_METRIC_KEYS = new Set(["additional_initiatives_delivered", "automation_adoption"]);

function adjustValueForPeriod(
  value: number | null,
  targetText: string | null | undefined,
  periodCount: number,
  metricKey?: string
) {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  if (metricKey && PER_PERIOD_SKIP_METRIC_KEYS.has(metricKey)) return value;
  if (!shouldUsePerPeriodTarget(targetText)) return value;
  if (!Number.isFinite(periodCount) || periodCount <= 0) return value;
  return value / periodCount;
}

function parseTargetRange(
  targetText?: string | null,
  metricType?: MetricSeries["type"],
): TargetRange | null {
  if (!targetText) return null;
  const normalized = targetText.toLowerCase().replace(/,/g, " ").replace(/\u2013/g, "-");
  const numbers = normalized.match(/-?\d+(\.\d+)?/g)?.map((value) => Number(value)) ?? [];
  if (numbers.length === 0) return null;

  const hasRangeText = /(\d+(\.\d+)?)\s*-\s*(\d+(\.\d+)?)/.test(normalized) || normalized.includes(" range");
  const hasToText = /\bto\b/.test(normalized);
  const hasExplicitMax = /(<=|≤|<|at most|no more than|max(imum)?|upper|not exceed)/.test(normalized);
  const hasExplicitMin = /(>=|≥|>|at least|min(imum)?|not less than)/.test(normalized);
  const maxInclusive = normalized.includes("<=") || normalized.includes("≤") || normalized.includes("at most") || normalized.includes("no more than");
  const maxExclusive = normalized.includes("<") && !normalized.includes("<=");
  const minInclusive = normalized.includes(">=") || normalized.includes("≥") || normalized.includes("at least") || normalized.includes("not less than");
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

function getTargetStatus(value: number | null, range: TargetRange | null): MetricTargetStatus {
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
]);

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

function parseBoolish(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "y", "yes", "true"].includes(normalized)) return true;
  if (["0", "n", "no", "false"].includes(normalized)) return false;
  return null;
}

function parseNumber(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(value: string | null | undefined) {
  const parsed = parseFlexibleDateString(value);
  return parsed.kind === "valid" ? parsed.date : null;
}

function normalizeHeaderValue(value: string) {
  return value.trim().toLowerCase();
}

function findColumnByFragments(headers: string[], fragments: string[]) {
  return headers.findIndex((header) => fragments.every((fragment) => header.includes(fragment)));
}

function getRawIssueColumns(headers: string[]): RawIssueColumns {
  const normalizedHeaders = headers.map(normalizeHeaderValue);
  const findByOptions = (options: string[][]) =>
    options.map((fragments) => findColumnByFragments(normalizedHeaders, fragments)).find((index) => index !== -1) ?? -1;

  return {
    ticketId: findByOptions([["ticket", "id"], ["ticket", "#"]]),
    deliveryDate: findByOptions([["delivery", "date"]]),
    dueDate: findByOptions([["due", "date"]]),
    workType: findByOptions([["type"]]),
    reworkFlag: findByOptions([["rework", "flag"], ["rework", "y/n"]]),
    reworkCount: findByOptions([["rework", "count"]]),
    escalationFlag: findByOptions([["esc", "flag"], ["escalat", "flag"], ["escalat", "y/n"]]),
    escalationLevel: findByOptions([["escalation", "level"]]),
    postDefectFlag: findByOptions([["pdd", "flag"], ["defect", "flag"]]),
    postDefectCount: findByOptions([["defect", "count"]]),
    ftrFlag: findByOptions([["ftr", "flag"], ["first", "time", "right"]]),
    scopeChange: findByOptions([["scope", "change"]]),
  };
}

function getIssueTypeForMetricKey(metricKey: string): RawIssueType | null {
  const normalized = metricKey.toLowerCase();
  if (normalized.includes("automation_adoption") || normalized.includes("qp_automated_projects")) {
    return "aiAdoption";
  }
  if (normalized.includes("escalation")) return "escalation";
  if (normalized.includes("post_delivery") || normalized.includes("post-delivery") || normalized.includes("defect")) {
    return "postDefect";
  }
  if (normalized.includes("rework")) return "rework";
  if (normalized.includes("first_time_right") || normalized.includes("deliverables_accepted") || normalized.includes("ftr")) {
    return "notFtr";
  }
  if (normalized.includes("on_time_delivery") || normalized.includes("projects_on_time_budget")) {
    return "late";
  }
  if (normalized.includes("scope")) {
    return "scopeChange";
  }
  return null;
}

function isScopeChangeMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("scope");
}

function isReworkMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("rework");
}

function isFtrMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("first_time_right") || normalized.includes("deliverables_accepted") || normalized.includes("ftr");
}

function isAiAdoptionMetricKey(metricKey: string) {
  const normalized = metricKey.toLowerCase();
  return normalized.includes("automation_adoption") || normalized.includes("qp_automated_projects");
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

function buildMonthSegments(start: Date, end: Date, rangeStart: Date | null, rangeEnd: Date | null) {
  let clippedStart = start;
  let clippedEnd = end;

  if (rangeStart && clippedEnd < rangeStart) {
    return [];
  }
  if (rangeEnd && clippedStart > rangeEnd) {
    return [];
  }
  if (rangeStart && clippedStart < rangeStart) {
    clippedStart = rangeStart;
  }
  if (rangeEnd && clippedEnd > rangeEnd) {
    clippedEnd = rangeEnd;
  }
  if (clippedStart > clippedEnd) {
    return [];
  }

  const segments: Array<{ monthKey: string; daysCovered: number }> = [];
  let cursor = new Date(clippedStart.getTime());
  while (cursor <= clippedEnd) {
    const monthStart = utcMonthStart(cursor);
    const monthEnd = utcMonthEnd(cursor);
    const segmentStart = clippedStart > monthStart ? clippedStart : monthStart;
    const segmentEnd = clippedEnd < monthEnd ? clippedEnd : monthEnd;
    const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
    if (daysCovered > 0) {
      segments.push({ monthKey: utcMonthKey(monthStart), daysCovered });
    }
    cursor = addUtcDays(monthEnd, 1);
  }

  return segments;
}

function resolveAggregatedMetricValues(
  metrics: Submission["template"]["goals"][number]["metrics"],
  aggregates: Map<string, MetricAggregate>
) {
  const variables: Record<string, number> = {};
  const resolved = new Map<string, number>();

  metrics.forEach((metric) => {
    if (metric.isComputed) return;
    const aggregate = aggregates.get(metric.key);
    if (!aggregate || aggregate.totalDays <= 0) return;
    const rawValue = aggregate.weightedTotal / aggregate.totalDays;
    variables[metric.key] = rawValue;
    resolved.set(metric.key, rawValue);
  });

  metrics.forEach((metric) => {
    if (!metric.isComputed || !metric.calcFormula) return;
    const computedValue = evaluateFormula(metric.calcFormula, variables);
    if (computedValue === null) return;
    let finalValue = computedValue;
    if (metric.min !== null && metric.min !== undefined) {
      finalValue = Math.max(metric.min, finalValue);
    }
    if (metric.max !== null && metric.max !== undefined) {
      finalValue = Math.min(metric.max, finalValue);
    }
    variables[metric.key] = finalValue;
    resolved.set(metric.key, finalValue);
  });

  return resolved;
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

  // Dashboard is personal-only; team data lives in Analytics.
  const canViewTeamProjects = false;
  const metricScopeLabel = "My";

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
        user?.role === "ADMIN" ? "/users?activeOnly=true" : "/users/team?activeOnly=true"
      ),
  });

  const [metricFromDate, setMetricFromDate] = useState("");
  const [metricToDate, setMetricToDate] = useState("");
  const [showMetricSnapshotFullscreen, setShowMetricSnapshotFullscreen] = useState(false);
  const [expandedSnapshotKeys, setExpandedSnapshotKeys] = useState<Set<string>>(new Set());
  const isMetricRangeInvalid = Boolean(metricFromDate && metricToDate && metricFromDate > metricToDate);
  const activeMetricRangeLabel = useMemo(() => {
    if (!metricFromDate && !metricToDate) {
      return "All time";
    }
    return `${metricFromDate || "..."} to ${metricToDate || "..."}`;
  }, [metricFromDate, metricToDate]);

  const approvedSubmissions = useMemo(
    () => (data?.submissions ?? []).filter((submission) => submission.status === "APPROVED"),
    [data?.submissions]
  );
  const filteredSubmissions = useMemo(() => {
    if (isMetricRangeInvalid) return [];
    const rangeStart = metricFromDate ? toUtcDateOnly(metricFromDate) : null;
    const rangeEnd = metricToDate ? toUtcDateOnly(metricToDate) : null;
    if (!rangeStart && !rangeEnd) return approvedSubmissions;
    return approvedSubmissions.filter((submission) => {
      const start = toUtcDateOnly(submission.periodStart);
      const end = toUtcDateOnly(submission.periodEnd);
      if (!start || !end || start > end) return false;
      if (rangeStart && end < rangeStart) return false;
      if (rangeEnd && start > rangeEnd) return false;
      return true;
    });
  }, [approvedSubmissions, metricFromDate, metricToDate, isMetricRangeInvalid]);

  const [selectedMetricKey, setSelectedMetricKey] = useState("");
  const metricSeries = useMemo<MetricSeries[]>(() => {
    const seriesMap = new Map<
      string,
      { meta: Omit<MetricSeries, "points">; points: Map<string, number> }
    >();
    const goalDefinitions = new Map<
      string,
      {
        key: string;
        name: string;
        order: number;
        metrics: Submission["template"]["goals"][number]["metrics"];
        displayMetrics: Submission["template"]["goals"][number]["metrics"];
      }
    >();
    const monthAggregates = new Map<string, Map<string, MetricAggregate>>();

    const rangeStart = metricFromDate ? toUtcDateOnly(metricFromDate) : null;
    const rangeEnd = metricToDate ? toUtcDateOnly(metricToDate) : null;

    filteredSubmissions.forEach((submission) => {
      const start = toUtcDateOnly(submission.periodStart);
      const end = toUtcDateOnly(submission.periodEnd);
      if (!start || !end || start > end) {
        return;
      }

      const segments = buildMonthSegments(start, end, rangeStart, rangeEnd);
      if (segments.length === 0) return;

      submission.template.goals.forEach((goal, goalIndex) => {
        const goalKey = goal.key || goal.id;
        const computedMetrics = goal.metrics.filter((metric) => metric.isComputed);
        const displayMetrics = (computedMetrics.length > 0 ? computedMetrics : goal.metrics)
          .filter((metric) => metric.key !== "schedule_adherence" && metric.key !== "process_compliance_rate");
        if (!goalDefinitions.has(goalKey)) {
          goalDefinitions.set(goalKey, {
            key: goalKey,
            name: goal.name,
            order: goal.order ?? goalIndex,
            metrics: goal.metrics,
            displayMetrics,
          });
        }
        displayMetrics.forEach((metric, metricIndex) => {
          if (seriesMap.has(metric.key)) return;
          seriesMap.set(metric.key, {
            meta: {
              key: metric.key,
              label: metric.label,
              type: metric.type,
              goalKey,
              goalName: goal.name,
              order: goal.order ?? goalIndex,
              metricOrder: metric.order ?? metricIndex,
              targetText: metric.targetText ?? null,
            },
            points: new Map(),
          });
        });
      });

      const valueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
      submission.template.goals.forEach((goal) => {
        goal.metrics.forEach((metric) => {
          if (metric.isComputed) return;
          const rawValue = valueMap.get(metric.id);
          if (rawValue === null || rawValue === undefined) return;
          segments.forEach((segment) => {
            const monthEntry = monthAggregates.get(segment.monthKey) ?? new Map();
            const aggregate = monthEntry.get(metric.key) ?? { weightedTotal: 0, totalDays: 0 };
            aggregate.weightedTotal += rawValue * segment.daysCovered;
            aggregate.totalDays += segment.daysCovered;
            monthEntry.set(metric.key, aggregate);
            if (!monthAggregates.has(segment.monthKey)) {
              monthAggregates.set(segment.monthKey, monthEntry);
            }
          });
        });
      });
    });

    const monthKeys = Array.from(monthAggregates.keys()).sort((a, b) => (a > b ? 1 : -1));
    monthKeys.forEach((monthKey) => {
      const aggregates = monthAggregates.get(monthKey);
      if (!aggregates) return;
      goalDefinitions.forEach((goal) => {
        const resolved = resolveAggregatedMetricValues(goal.metrics, aggregates);
        goal.displayMetrics.forEach((metric) => {
          const value = resolved.get(metric.key);
          if (value === undefined) return;
          const entry = seriesMap.get(metric.key);
          if (!entry) return;
          entry.points.set(monthKey, value);
        });
      });
    });

    return Array.from(seriesMap.values())
      .map((entry) => ({
        ...entry.meta,
        points: Array.from(entry.points.entries())
          .map(([monthKey, value]) => ({ monthKey, value }))
          .sort((a, b) => (a.monthKey > b.monthKey ? 1 : -1)),
      }))
      .filter((series) => series.points.length > 0)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        if (a.metricOrder !== b.metricOrder) return a.metricOrder - b.metricOrder;
        return a.label.localeCompare(b.label);
      });
  }, [filteredSubmissions, metricFromDate, metricToDate]);

  const metricSnapshotRows = useMemo<MetricSnapshotRow[]>(() => {
    if (isMetricRangeInvalid || metricSeries.length === 0) return [];

    const goalDefinitions = new Map<
      string,
      {
        metrics: Submission["template"]["goals"][number]["metrics"];
        displayMetrics: Submission["template"]["goals"][number]["metrics"];
      }
    >();
    const rangeAggregates = new Map<string, MetricAggregate>();

    const rangeStart = metricFromDate ? toUtcDateOnly(metricFromDate) : null;
    const rangeEnd = metricToDate ? toUtcDateOnly(metricToDate) : null;

    filteredSubmissions.forEach((submission) => {
      const start = toUtcDateOnly(submission.periodStart);
      const end = toUtcDateOnly(submission.periodEnd);
      if (!start || !end || start > end) {
        return;
      }

      let clippedStart = start;
      let clippedEnd = end;
      if (rangeStart && clippedEnd < rangeStart) return;
      if (rangeEnd && clippedStart > rangeEnd) return;
      if (rangeStart && clippedStart < rangeStart) clippedStart = rangeStart;
      if (rangeEnd && clippedEnd > rangeEnd) clippedEnd = rangeEnd;
      if (clippedStart > clippedEnd) return;

      if (daySpanInclusive(clippedStart, clippedEnd) <= 0) return;

      submission.template.goals.forEach((goal) => {
        const goalKey = goal.key || goal.id;
        const computedMetrics = goal.metrics.filter((metric) => metric.isComputed);
        const displayMetrics = (computedMetrics.length > 0 ? computedMetrics : goal.metrics)
          .filter((metric) => metric.key !== "schedule_adherence" && metric.key !== "process_compliance_rate");
        if (!goalDefinitions.has(goalKey)) {
          goalDefinitions.set(goalKey, {
            metrics: goal.metrics,
            displayMetrics,
          });
        }
      });

      const valueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
      submission.template.goals.forEach((goal) => {
        goal.metrics.forEach((metric) => {
          if (metric.isComputed) return;
          const rawValue = valueMap.get(metric.id);
          if (rawValue === null || rawValue === undefined) return;
          const aggregate = rangeAggregates.get(metric.key) ?? { weightedTotal: 0, totalDays: 1 };
          aggregate.weightedTotal += rawValue;
          aggregate.totalDays = 1;
          rangeAggregates.set(metric.key, aggregate);
        });
      });
    });

    const rangeResolvedByMetricKey = new Map<string, number>();
    goalDefinitions.forEach((goal) => {
      const resolved = resolveAggregatedMetricValues(goal.metrics, rangeAggregates);
      goal.displayMetrics.forEach((metric) => {
        const value = resolved.get(metric.key);
        if (value === undefined) return;
        rangeResolvedByMetricKey.set(metric.key, value);
      });
    });

    return metricSeries.map((series) => ({
      ...series,
      rangeValue: rangeResolvedByMetricKey.get(series.key) ?? null,
    }));
  }, [
    filteredSubmissions,
    isMetricRangeInvalid,
    metricFromDate,
    metricToDate,
    metricSeries,
  ]);
  const metricSnapshotGroups = useMemo(
    () =>
      metricSnapshotRows.reduce<Array<{ goalKey: string; goalName: string; rows: MetricSnapshotRow[] }>>(
        (groups, row) => {
          const currentGroup = groups[groups.length - 1];
          if (currentGroup && currentGroup.goalKey === row.goalKey) {
            currentGroup.rows.push(row);
            return groups;
          }

          groups.push({
            goalKey: row.goalKey,
            goalName: row.goalName,
            rows: [row],
          });
          return groups;
        },
        []
      ),
    [metricSnapshotRows]
  );

  const metricSnapshotPeriodCount = useMemo(() => {
    if (isMetricRangeInvalid) return 0;
    const rangeStart = metricFromDate ? toUtcDateOnly(metricFromDate) : null;
    const rangeEnd = metricToDate ? toUtcDateOnly(metricToDate) : null;
    let count = 0;

    filteredSubmissions.forEach((submission) => {
      const start = toUtcDateOnly(submission.periodStart);
      const end = toUtcDateOnly(submission.periodEnd);
      if (!start || !end || start > end) return;

      let clippedStart = start;
      let clippedEnd = end;
      if (rangeStart && clippedEnd < rangeStart) return;
      if (rangeEnd && clippedStart > rangeEnd) return;
      if (rangeStart && clippedStart < rangeStart) clippedStart = rangeStart;
      if (rangeEnd && clippedEnd > rangeEnd) clippedEnd = rangeEnd;
      if (clippedStart > clippedEnd) return;
      if (daySpanInclusive(clippedStart, clippedEnd) <= 0) return;
      count += 1;
    });

    return count;
  }, [filteredSubmissions, isMetricRangeInvalid, metricFromDate, metricToDate]);

  const metricTargetStatusByKey = useMemo(() => {
    const map = new Map<string, MetricTargetStatus>();
    metricSnapshotRows.forEach((row) => {
      const adjustedValue = adjustValueForPeriod(
        row.rangeValue,
        row.targetText ?? null,
        metricSnapshotPeriodCount,
        row.key
      );
      const targetRange = parseTargetRange(row.targetText ?? null, row.type);
      map.set(row.key, getTargetStatus(adjustedValue, targetRange));
    });
    return map;
  }, [metricSnapshotPeriodCount, metricSnapshotRows]);

  const metricIssueTicketsByKey = useMemo(() => {
    const map = new Map<string, IssueTicket[]>();
    if (metricSnapshotRows.length === 0) return map;

    const keysByIssueType = new Map<RawIssueType, string[]>();
    metricSnapshotRows.forEach((row) => {
      const status = metricTargetStatusByKey.get(row.key);
      const includeBecauseRed = status === "out";
      const includeBecauseRework = isReworkMetricKey(row.key);
      const includeBecauseScope = isScopeChangeMetricKey(row.key);
      const includeBecauseFtr = isFtrMetricKey(row.key);
      if (!includeBecauseRed && !includeBecauseRework && !includeBecauseScope && !includeBecauseFtr) return;
      const issueType = getIssueTypeForMetricKey(row.key);
      if (!issueType) return;
      const list = keysByIssueType.get(issueType) ?? [];
      list.push(row.key);
      keysByIssueType.set(issueType, list);
    });

    if (keysByIssueType.size === 0) return map;

    const addTicket = (metricKey: string, ticket: IssueTicket) => {
      const current = map.get(metricKey) ?? [];
      if (current.some((existing) => existing.id === ticket.id)) return;
      current.push(ticket);
      map.set(metricKey, current);
    };

    const addTicketForIssue = (issueType: RawIssueType, ticket: IssueTicket) => {
      const keys = keysByIssueType.get(issueType);
      if (!keys) return;
      keys.forEach((metricKey) => addTicket(metricKey, ticket));
    };

    filteredSubmissions.forEach((submission) => {
      const rawDeliveryData = submission.rawDeliveryData;
      if (!rawDeliveryData || rawDeliveryData.rows.length === 0) return;
      const columns = getRawIssueColumns(rawDeliveryData.headers);
      if (columns.ticketId === -1) return;

      rawDeliveryData.rows.forEach((row, rowIndex) => {
        const ticketId = row[columns.ticketId]?.trim();
        if (!ticketId) return;
        const ticketLink = rawDeliveryData.links?.[rowIndex]?.[columns.ticketId] ?? null;

        const escalationFlag =
          columns.escalationFlag !== -1 ? parseBoolish(row[columns.escalationFlag]) : null;
        const escalationLevel =
          columns.escalationLevel !== -1 ? row[columns.escalationLevel]?.trim().toLowerCase() : "";
        const escalated =
          escalationFlag !== null ? escalationFlag : escalationLevel.length > 0 && escalationLevel !== "none";

        const postDefectFlag =
          columns.postDefectFlag !== -1 ? parseBoolish(row[columns.postDefectFlag]) : null;
        const postDefectCount =
          columns.postDefectCount !== -1 ? parseNumber(row[columns.postDefectCount]) : 0;
        const postDefect = postDefectFlag !== null ? postDefectFlag : postDefectCount > 0;

        const reworkFlag = columns.reworkFlag !== -1 ? parseBoolish(row[columns.reworkFlag]) : null;
        const reworkCount = columns.reworkCount !== -1 ? parseNumber(row[columns.reworkCount]) : 0;
        const rework = reworkFlag !== null ? reworkFlag : reworkCount > 0;

        const ftrFlag = columns.ftrFlag !== -1 ? parseBoolish(row[columns.ftrFlag]) : null;
        const notFtr = ftrFlag !== null ? !ftrFlag : rework;

        const deliveryDate = columns.deliveryDate !== -1 ? parseDateValue(row[columns.deliveryDate]) : null;
        const dueDate = columns.dueDate !== -1 ? parseDateValue(row[columns.dueDate]) : null;
        const late = Boolean(deliveryDate && dueDate && deliveryDate.getTime() > dueDate.getTime());
        const workType = columns.workType !== -1 ? row[columns.workType]?.trim().toLowerCase() : "";
        const aiAdoption = workType === "ai adoption" || workType === "automation";

        const scopeChangeFlag =
          columns.scopeChange !== -1 ? parseBoolish(row[columns.scopeChange]) === true : false;

        const ticket = { id: ticketId, link: ticketLink };

        if (aiAdoption) addTicketForIssue("aiAdoption", ticket);
        if (escalated) addTicketForIssue("escalation", ticket);
        if (postDefect) addTicketForIssue("postDefect", ticket);
        if (rework) addTicketForIssue("rework", ticket);
        if (notFtr) addTicketForIssue("notFtr", ticket);
        if (late) addTicketForIssue("late", ticket);
        if (scopeChangeFlag) addTicketForIssue("scopeChange", ticket);
      });
    });

    return map;
  }, [filteredSubmissions, metricSnapshotRows, metricTargetStatusByKey]);

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

  const latestMetricMonthKey = useMemo(() => {
    let latest: string | null = null;
    metricSeries.forEach((series) => {
      const point = series.points[series.points.length - 1];
      if (!point) return;
      if (!latest || point.monthKey > latest) {
        latest = point.monthKey;
      }
    });
    return latest;
  }, [metricSeries]);

  const selectedMetric = useMemo(() => {
    if (metricSeries.length === 0) return null;
    return metricSeries.find((series) => series.key === selectedMetricKey) ?? metricSeries[0];
  }, [metricSeries, selectedMetricKey]);

  const selectedMetricTrend = useMemo(() => {
    if (!selectedMetric) return [];
    return selectedMetric.points.map((point) => ({
      date: formatMonthLabel(point.monthKey),
      value: point.value,
    }));
  }, [selectedMetric]);
  const selectedMetricLatestValue = useMemo(() => {
    if (!selectedMetric || selectedMetric.points.length === 0) return null;
    return selectedMetric.points[selectedMetric.points.length - 1].value;
  }, [selectedMetric]);

  const projects = projectsData?.projects ?? [];

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
    if (metricSeries.length === 0) {
      if (selectedMetricKey) {
        setSelectedMetricKey("");
      }
      return;
    }
    if (!metricSeries.some((series) => series.key === selectedMetricKey)) {
      setSelectedMetricKey(metricSeries[0].key);
    }
  }, [metricSeries, selectedMetricKey]);

  useEffect(() => {
    setExpandedSnapshotKeys(new Set());
  }, [metricFromDate, metricToDate, filteredSubmissions.length]);

  useEffect(() => {
    setOrgPage(1);
  }, [teamProjectRows.length]);

  const metricSnapshotContent = (
    <div className="chart">
      {isMetricRangeInvalid ? (
        <div className="empty-state">Select a valid date range to load metrics.</div>
      ) : metricSnapshotRows.length === 0 ? (
        <div className="empty-state">No metrics available.</div>
      ) : (
        <div className="analytics-goal-detail-table">
          <div className="analytics-goal-detail-row analytics-goal-detail-row-header metric-snapshot-row">
            <div>Metric</div>
            <div>Target</div>
            <div>Rate</div>
          </div>
          {metricSnapshotGroups.map((group) => (
            <Fragment key={`metric-snapshot-group-${group.goalKey}`}>
              <div className="metric-snapshot-group-header">
                <span className="metric-snapshot-group-title">{group.goalName}</span>
                <span className="metric-snapshot-group-meta">
                  {group.rows.length} {group.rows.length === 1 ? "metric" : "metrics"}
                </span>
              </div>
              {group.rows.map((row) => {
                const adjustedValue = adjustValueForPeriod(
                  row.rangeValue,
                  row.targetText ?? null,
                  metricSnapshotPeriodCount,
                  row.key
                );
                const progress = getMetricProgressPercent(adjustedValue, row.type);
                const rateValue = progress === null ? formatMetricValue(adjustedValue, row.type) : null;
                const rateText = progress === null ? rateValue : `${progress.toFixed(2)}%`;
                const displayRateText = rateText ?? "--";
                const isRateMuted = displayRateText === "--";
                const thresholdStatus = getThresholdStatus(row.key, adjustedValue);
                const targetStatus = metricTargetStatusByKey.get(row.key) ?? "unknown";
                const visualStatus = getSnapshotVisualStatus(row.key, adjustedValue, thresholdStatus ?? targetStatus);
                const statusClass = getSnapshotStatusClass(visualStatus);
                const issueTickets = metricIssueTicketsByKey.get(row.key) ?? [];
                const isReworkMetric = isReworkMetricKey(row.key);
                const isAiAdoptionMetric = isAiAdoptionMetricKey(row.key);
                const isScopeChangeMetric = isScopeChangeMetricKey(row.key);
                const isFtrMetric = isFtrMetricKey(row.key);
                const canShowIssues =
                  visualStatus !== "warning" &&
                  (targetStatus === "out" ||
                    (isReworkMetric && issueTickets.length > 0) ||
                    (isAiAdoptionMetric && issueTickets.length > 0) ||
                    (isScopeChangeMetric && issueTickets.length > 0) ||
                    (isFtrMetric && issueTickets.length > 0));
                const isExpanded = expandedSnapshotKeys.has(row.key);

                return (
                  <Fragment key={`metric-snapshot-${row.key}`}>
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
                            <span className={isRateMuted ? "metric-summary-muted" : "metric-rate-value"}>
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
      )}
    </div>
  );

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
      {showMetricSnapshotFullscreen && (
        <div
          className="metric-snapshot-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowMetricSnapshotFullscreen(false)}
        >
          <div
            className="metric-snapshot-modal-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="panel-header">
              <div>
                <h3>Metric Snapshot</h3>
                <span className="panel-sub">Snapshot across selected period</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowMetricSnapshotFullscreen(false)}
              >
                Close
              </button>
            </div>
            {metricSnapshotContent}
          </div>
        </div>
      )}
      <div className="panel analytics-date-panel">
        <div className="panel-header">
          <h3>Metric Date Range</h3>
          <span className="panel-sub">Applies to metric trend and snapshot · Scope: {metricScopeLabel}</span>
        </div>
        <div className="form-grid team-filter-grid">
          <DateRangePicker
            fromDate={metricFromDate}
            toDate={metricToDate}
            onChangeFrom={setMetricFromDate}
            onChangeTo={setMetricToDate}
          />
        </div>
        <div className="table-actions">
          <span className="panel-sub">Active range: {activeMetricRangeLabel}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMetricFromDate("");
              setMetricToDate("");
            }}
          >
            Reset range
          </button>
        </div>
        {isMetricRangeInvalid && (
          <div className="form-error">Start date must be before or equal to end date.</div>
        )}
      </div>
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Latest Metric Period</div>
          <div className="stat-value">
            {latestMetricMonthKey ? formatMonthLabel(latestMetricMonthKey) : "--"}
          </div>
          <div className="stat-sub">
            {latestMetricMonthKey
              ? `Scope: ${metricScopeLabel} · ${activeMetricRangeLabel}`
              : "No submissions yet"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tracked Metrics</div>
          <div className="stat-value">{metricSeries.length}</div>
          <div className="stat-sub">Computed metrics shown · Scope: {metricScopeLabel}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Selected Metric</div>
          <div className="stat-value">
            {selectedMetric
              ? formatMetricValue(selectedMetricLatestValue, selectedMetric.type)
              : "--"}
          </div>
          <div className="stat-sub">{selectedMetric ? selectedMetric.label : "Choose a metric"}</div>
        </div>
        <button type="button" className="stat-card stat-card-button" onClick={showActiveProjectsFromCard}>
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{activeProjects.length}</div>
          <div className="stat-sub">Click to open your active projects</div>
        </button>
      </section>

      {isMetricRangeInvalid ? (
        <div className="panel empty-state">
          <h3>Select a valid date range</h3>
          <p>Adjust the metric date range to load the dashboard charts.</p>
        </div>
      ) : metricSeries.length === 0 ? (
        <div className="panel empty-state">
          <h3>No KPI submissions yet</h3>
          <p>Your dashboard updates only after manager or admin approval.</p>
        </div>
      ) : (
        <section className="chart-grid">
          <div className="panel chart-card">
            <div className="panel-header">
              <h3>Metric Trend</h3>
              <span className="panel-sub">
                Trend across selected range · Scope: {metricScopeLabel}
              </span>
            </div>
            <div className="form-grid">
              <label className="form-field">
                <span>Metric</span>
                <select
                  value={selectedMetric?.key ?? ""}
                  onChange={(event) => setSelectedMetricKey(event.target.value)}
                >
                  {metricSeries.map((series) => (
                    <option key={`metric-option-${series.key}`} value={series.key}>
                      {series.goalName} — {series.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="chart">
              {isMetricRangeInvalid ? (
                <div className="empty-state">Select a valid date range to load metrics.</div>
              ) : selectedMetricTrend.length === 0 ? (
                <div className="empty-state">No metric trend data available.</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={selectedMetricTrend}>
                    <XAxis dataKey="date" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(value) => {
                        const parsed = typeof value === "number" ? value : Number(value);
                        if (!Number.isFinite(parsed)) return String(value ?? "");
                        return formatMetricValue(parsed, selectedMetric?.type ?? "NUMBER");
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#f29d38"
                      strokeWidth={3}
                      dot={selectedMetricTrend.length <= 1 ? { r: 4 } : false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="panel chart-card">
            <div className="panel-header">
              <div>
                <h3>Metric Snapshot</h3>
                <span className="panel-sub">Snapshot across selected period</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowMetricSnapshotFullscreen(true)}
                disabled={metricSnapshotRows.length === 0}
                title="Full screen"
                aria-label="Full screen"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="icon-btn-svg">
                  <path
                    d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            {metricSnapshotContent}
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
