import { MetricType, Role, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { computeMetricValues, computeOverallScore } from "../utils/score.js";

function normalizeScore(score: number | null) {
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
}

const ANALYTICS_VISIBLE_STATUSES: SubmissionStatus[] = [SubmissionStatus.APPROVED];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type AnalyticsDateRange = {
  from?: Date;
  to?: Date;
};

type IntervalScoreRow = {
  periodStart: Date;
  periodEnd: Date;
  score: number | null;
};

type MonthlyScorePoint = {
  monthKey: string;
  score: number;
};

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
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

function maxDate(a: Date, b: Date) {
  return a > b ? a : b;
}

function minDate(a: Date, b: Date) {
  return a < b ? a : b;
}

function buildSubmissionDateRangeWhere(range?: AnalyticsDateRange) {
  if (!range?.from && !range?.to) {
    return {};
  }

  const andFilters: Array<Record<string, unknown>> = [];
  if (range.from) {
    andFilters.push({ periodEnd: { gte: range.from } });
  }
  if (range.to) {
    andFilters.push({ periodStart: { lte: range.to } });
  }

  return andFilters.length > 0 ? { AND: andFilters } : {};
}

function buildMonthlyScorePoints(rows: IntervalScoreRow[]): MonthlyScorePoint[] {
  const buckets = new Map<string, { weightedTotal: number; totalDays: number }>();

  for (const row of rows) {
    const start = toUtcDateOnly(row.periodStart);
    const end = toUtcDateOnly(row.periodEnd);
    if (start > end) {
      continue;
    }

    let cursor = new Date(start.getTime());
    while (cursor <= end) {
      const monthStart = utcMonthStart(cursor);
      const monthEnd = utcMonthEnd(cursor);
      const segmentStart = maxDate(start, monthStart);
      const segmentEnd = minDate(end, monthEnd);
      const daysCovered = daySpanInclusive(segmentStart, segmentEnd);

      if (daysCovered > 0) {
        const key = utcMonthKey(monthStart);
        const current = buckets.get(key) ?? { weightedTotal: 0, totalDays: 0 };
        current.weightedTotal += normalizeScore(row.score) * daysCovered;
        current.totalDays += daysCovered;
        buckets.set(key, current);
      }

      cursor = addUtcDays(monthEnd, 1);
    }
  }

  return Array.from(buckets.entries())
    .map(([monthKey, value]) => ({
      monthKey,
      score: value.totalDays > 0 ? value.weightedTotal / value.totalDays : 0,
    }))
    .sort((a, b) => (a.monthKey > b.monthKey ? 1 : -1));
}

type AnalyticsTargetUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId?: string | null;
};

async function resolveAnalyticsTargetUser(
  requesterId: string,
  requesterRole: Role,
  targetUserId: string
): Promise<AnalyticsTargetUser> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, role: true, managerId: true },
  });

  if (!target) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  if (requesterRole === Role.ADMIN) {
    return target;
  }

  if (target.id !== requesterId && target.managerId !== requesterId) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  return target;
}

export async function getUserAnalytics(userId: string, range?: AnalyticsDateRange) {
  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId,
      status: { in: ANALYTICS_VISIBLE_STATUSES },
      ...buildSubmissionDateRangeWhere(range),
    },
    orderBy: { periodEnd: "asc" },
    select: { periodStart: true, periodEnd: true, score: true },
  });

  const points = buildMonthlyScorePoints(submissions).map((item) => ({
    date: item.monthKey,
    score: item.score,
  }));

  const rollingWindow = 3;
  const rollingAverage = points.map((point, index) => {
    const start = Math.max(0, index - rollingWindow + 1);
    const window = points.slice(start, index + 1);
    const avg = window.reduce((acc, cur) => acc + cur.score, 0) / window.length;
    return { date: point.date, value: avg };
  });

  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const delta = last && previous ? last.score - previous.score : 0;

  return {
    points,
    rollingAverage,
    summary: {
      total: points.length,
      lastScore: last?.score ?? 0,
      delta,
    },
  };
}

export async function getTeamAnalytics(
  requesterId: string,
  requesterRole: Role,
  range?: AnalyticsDateRange
) {
  let userFilter: string[] = [];

  if (requesterRole === Role.ADMIN) {
    const users = await prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.MANAGER] } },
      select: { id: true },
    });
    userFilter = users.map((user) => user.id);
  } else {
    const reports = await prisma.user.findMany({
      where: { managerId: requesterId },
      select: { id: true },
    });
    userFilter = reports.map((report) => report.id);
  }

  if (userFilter.length === 0) {
    return {
      ranking: [],
      trend: [],
      summary: { totalEmployees: 0, averageScore: 0 },
    };
  }

  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId: { in: userFilter },
      status: { in: ANALYTICS_VISIBLE_STATUSES },
      ...buildSubmissionDateRangeWhere(range),
    },
    orderBy: { periodEnd: "asc" },
    select: {
      userId: true,
      periodStart: true,
      periodEnd: true,
      score: true,
      user: { select: { name: true } },
    },
  });

  const rowsByUser = new Map<string, { name: string; rows: IntervalScoreRow[] }>();
  for (const submission of submissions) {
    const userRows = rowsByUser.get(submission.userId) ?? {
      name: submission.user?.name ?? "Unknown",
      rows: [],
    };
    userRows.rows.push({
      periodStart: submission.periodStart,
      periodEnd: submission.periodEnd,
      score: submission.score,
    });
    rowsByUser.set(submission.userId, userRows);
  }

  const userMonthRows: Array<{ userId: string; name: string; monthKey: string; score: number }> = [];
  for (const [userId, info] of rowsByUser.entries()) {
    const monthlyPoints = buildMonthlyScorePoints(info.rows);
    monthlyPoints.forEach((point) => {
      userMonthRows.push({
        userId,
        name: info.name,
        monthKey: point.monthKey,
        score: point.score,
      });
    });
  }

  const byUser = new Map<string, { name: string; total: number; count: number }>();
  const byDate = new Map<string, { total: number; count: number }>();

  for (const item of userMonthRows) {
    const userEntry = byUser.get(item.userId) ?? {
      name: item.name,
      total: 0,
      count: 0,
    };
    userEntry.total += item.score;
    userEntry.count += 1;
    byUser.set(item.userId, userEntry);

    const dateEntry = byDate.get(item.monthKey) ?? { total: 0, count: 0 };
    dateEntry.total += item.score;
    dateEntry.count += 1;
    byDate.set(item.monthKey, dateEntry);
  }

  const ranking = Array.from(byUser.entries())
    .map(([userId, info]) => ({
      userId,
      name: info.name,
      averageScore: info.count > 0 ? info.total / info.count : 0,
      submissions: info.count,
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  const trend = Array.from(byDate.entries())
    .map(([date, entry]) => ({
      date,
      averageScore: entry.count > 0 ? entry.total / entry.count : 0,
    }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const overallAverage =
    ranking.length > 0 ? ranking.reduce((acc, cur) => acc + cur.averageScore, 0) / ranking.length : 0;

  return {
    ranking,
    trend,
    summary: {
      totalEmployees: ranking.length,
      averageScore: overallAverage,
    },
  };
}

export async function getTeamMemberAnalytics(
  requesterId: string,
  requesterRole: Role,
  targetUserId: string,
  range?: AnalyticsDateRange
) {
  const user = await resolveAnalyticsTargetUser(requesterId, requesterRole, targetUserId);
  const analytics = await getUserAnalytics(user.id, range);
  const goalProgress = await getUserGoalProgress(user.id, range);
  const goalMetricProgress = await getUserGoalMetricProgress(user.id, range);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    goalProgress,
    goalMetricProgress,
    ...analytics,
  };
}

async function getUserGoalProgress(userId: string, range?: AnalyticsDateRange) {
  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId,
      status: { in: ANALYTICS_VISIBLE_STATUSES },
      ...buildSubmissionDateRangeWhere(range),
    },
    orderBy: { periodEnd: "asc" },
    select: {
      periodStart: true,
      periodEnd: true,
      template: {
        select: {
          formula: true,
          goals: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              key: true,
              name: true,
              formula: true,
              weight: true,
              metrics: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      },
      values: {
        select: {
          metricId: true,
          valueNumber: true,
        },
      },
    },
  });

  const byGoalMonth = new Map<
    string,
    { goalId: string; key: string; name: string; monthKey: string; weightedTotal: number; totalDays: number }
  >();
  const goalOrder = new Map<string, number>();

  for (const submission of submissions) {
    const scoreResult = computeOverallScore({
      goals: submission.template.goals,
      values: submission.values,
      overallFormula: submission.template.formula,
    });

    const start = toUtcDateOnly(submission.periodStart);
    const end = toUtcDateOnly(submission.periodEnd);
    if (start > end) {
      continue;
    }

    let cursor = new Date(start.getTime());
    while (cursor <= end) {
      const monthStart = utcMonthStart(cursor);
      const monthEnd = utcMonthEnd(cursor);
      const segmentStart = maxDate(start, monthStart);
      const segmentEnd = minDate(end, monthEnd);
      const daysCovered = daySpanInclusive(segmentStart, segmentEnd);

      if (daysCovered > 0) {
        const monthKey = utcMonthKey(monthStart);
        scoreResult.goalScores.forEach((goal, index) => {
          if (goal.score === null || goal.score === undefined) {
            return;
          }
          const aggregateKey = goal.key || goal.goalId;
          if (!goalOrder.has(aggregateKey)) {
            goalOrder.set(aggregateKey, index);
          }
          const goalMonthKey = `${aggregateKey}::${monthKey}`;
          const existing = byGoalMonth.get(goalMonthKey);
          if (!existing) {
            byGoalMonth.set(goalMonthKey, {
              goalId: goal.goalId,
              key: goal.key,
              name: goal.name,
              monthKey,
              weightedTotal: goal.score * daysCovered,
              totalDays: daysCovered,
            });
            return;
          }
          existing.weightedTotal += goal.score * daysCovered;
          existing.totalDays += daysCovered;
        });
      }

      cursor = addUtcDays(monthEnd, 1);
    }
  }

  const byGoal = new Map<
    string,
    { goalId: string; key: string; name: string; total: number; count: number; order: number }
  >();

  Array.from(byGoalMonth.values()).forEach((goalMonth) => {
    if (goalMonth.totalDays <= 0) {
      return;
    }
    const score = goalMonth.weightedTotal / goalMonth.totalDays;
    const aggregateKey = goalMonth.key || goalMonth.goalId;
    const existing = byGoal.get(aggregateKey);
    if (!existing) {
      byGoal.set(aggregateKey, {
        goalId: goalMonth.goalId,
        key: goalMonth.key,
        name: goalMonth.name,
        total: score,
        count: 1,
        order: goalOrder.get(aggregateKey) ?? 0,
      });
      return;
    }
    existing.total += score;
    existing.count += 1;
  });

  return Array.from(byGoal.values())
    .map((item) => ({
      goalId: item.goalId,
      key: item.key,
      name: item.name,
      averageScore: item.count > 0 ? item.total / item.count : 0,
      submissions: item.count,
      order: item.order,
    }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name);
    });
}

async function getUserGoalMetricProgress(userId: string, range?: AnalyticsDateRange) {
  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId,
      status: { in: ANALYTICS_VISIBLE_STATUSES },
      ...buildSubmissionDateRangeWhere(range),
    },
    orderBy: { periodEnd: "asc" },
    select: {
      periodStart: true,
      periodEnd: true,
      template: {
        select: {
          goals: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              key: true,
              name: true,
              order: true,
              metrics: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      },
      values: {
        select: {
          metricId: true,
          valueNumber: true,
        },
      },
    },
  });

  const byGoalMetricMonth = new Map<
    string,
    {
      goalId: string;
      goalKey: string;
      goalName: string;
      goalOrder: number;
      metricId: string;
      metricKey: string;
      metricLabel: string;
      metricType: MetricType;
      metricOrder: number;
      weightedTotal: number;
      totalDays: number;
    }
  >();

  for (const submission of submissions) {
    const start = toUtcDateOnly(submission.periodStart);
    const end = toUtcDateOnly(submission.periodEnd);
    if (start > end) {
      continue;
    }

    const monthSegments: Array<{ monthKey: string; daysCovered: number }> = [];
    let cursor = new Date(start.getTime());
    while (cursor <= end) {
      const monthStart = utcMonthStart(cursor);
      const monthEnd = utcMonthEnd(cursor);
      const segmentStart = maxDate(start, monthStart);
      const segmentEnd = minDate(end, monthEnd);
      const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
      if (daysCovered > 0) {
        monthSegments.push({
          monthKey: utcMonthKey(monthStart),
          daysCovered,
        });
      }
      cursor = addUtcDays(monthEnd, 1);
    }

    if (monthSegments.length === 0) {
      continue;
    }

    for (const goal of submission.template.goals) {
      const resolvedValues = computeMetricValues(goal.metrics, submission.values);
      const computedMetrics = goal.metrics.filter((metric) => metric.isComputed);
      const metricsToDisplay = computedMetrics.length > 0 ? computedMetrics : goal.metrics;
      const goalAggregateKey = goal.key || goal.id;

      for (const metric of metricsToDisplay) {
        const metricValue = resolvedValues.get(metric.id);
        if (metricValue === undefined) {
          continue;
        }
        const metricAggregateKey = metric.key || metric.id;

        for (const segment of monthSegments) {
          const key = `${goalAggregateKey}::${metricAggregateKey}::${segment.monthKey}`;
          const existing = byGoalMetricMonth.get(key);
          if (!existing) {
            byGoalMetricMonth.set(key, {
              goalId: goal.id,
              goalKey: goal.key,
              goalName: goal.name,
              goalOrder: goal.order,
              metricId: metric.id,
              metricKey: metric.key,
              metricLabel: metric.label,
              metricType: metric.type,
              metricOrder: metric.order,
              weightedTotal: metricValue * segment.daysCovered,
              totalDays: segment.daysCovered,
            });
            continue;
          }
          existing.weightedTotal += metricValue * segment.daysCovered;
          existing.totalDays += segment.daysCovered;
        }
      }
    }
  }

  const byGoal = new Map<
    string,
    {
      goalId: string;
      key: string;
      name: string;
      order: number;
      metrics: Map<
        string,
        {
          metricId: string;
          key: string;
          label: string;
          type: MetricType;
          order: number;
          total: number;
          count: number;
        }
      >;
    }
  >();

  Array.from(byGoalMetricMonth.values()).forEach((goalMetricMonth) => {
    if (goalMetricMonth.totalDays <= 0) {
      return;
    }
    const monthAverage = goalMetricMonth.weightedTotal / goalMetricMonth.totalDays;
    const goalAggregateKey = goalMetricMonth.goalKey || goalMetricMonth.goalId;
    const metricAggregateKey = goalMetricMonth.metricKey || goalMetricMonth.metricId;
    const goalEntry = byGoal.get(goalAggregateKey) ?? {
      goalId: goalMetricMonth.goalId,
      key: goalMetricMonth.goalKey,
      name: goalMetricMonth.goalName,
      order: goalMetricMonth.goalOrder,
      metrics: new Map(),
    };
    const metricEntry = goalEntry.metrics.get(metricAggregateKey);
    if (!metricEntry) {
      goalEntry.metrics.set(metricAggregateKey, {
        metricId: goalMetricMonth.metricId,
        key: goalMetricMonth.metricKey,
        label: goalMetricMonth.metricLabel,
        type: goalMetricMonth.metricType,
        order: goalMetricMonth.metricOrder,
        total: monthAverage,
        count: 1,
      });
    } else {
      metricEntry.total += monthAverage;
      metricEntry.count += 1;
    }
    byGoal.set(goalAggregateKey, goalEntry);
  });

  return Array.from(byGoal.values())
    .map((goal) => ({
      goalId: goal.goalId,
      key: goal.key,
      name: goal.name,
      order: goal.order,
      metrics: Array.from(goal.metrics.values())
        .map((metric) => ({
          metricId: metric.metricId,
          key: metric.key,
          label: metric.label,
          type: metric.type,
          averageValue: metric.count > 0 ? metric.total / metric.count : 0,
          submissions: metric.count,
          order: metric.order,
        }))
        .sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.label.localeCompare(b.label);
        }),
    }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name);
    });
}
