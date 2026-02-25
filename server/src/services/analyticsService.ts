import { Role, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { computeOverallScore } from "../utils/score.js";

function normalizeScore(score: number | null) {
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
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

export async function getUserAnalytics(userId: string) {
  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId,
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED, SubmissionStatus.IN_REVIEW] },
    },
    orderBy: { periodEnd: "asc" },
    select: { periodEnd: true, score: true, status: true },
  });

  const points = submissions.map((item) => ({
    date: item.periodEnd.toISOString().slice(0, 10),
    score: normalizeScore(item.score),
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

export async function getTeamAnalytics(requesterId: string, requesterRole: Role) {
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
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED, SubmissionStatus.IN_REVIEW] },
    },
    orderBy: { periodEnd: "asc" },
    select: {
      userId: true,
      periodEnd: true,
      score: true,
      user: { select: { name: true } },
    },
  });

  const byUser = new Map<string, { name: string; total: number; count: number }>();
  const byDate = new Map<string, { total: number; count: number }>();

  for (const submission of submissions) {
    const score = normalizeScore(submission.score);
    const userEntry = byUser.get(submission.userId) ?? {
      name: submission.user?.name ?? "Unknown",
      total: 0,
      count: 0,
    };
    userEntry.total += score;
    userEntry.count += 1;
    byUser.set(submission.userId, userEntry);

    const dateKey = submission.periodEnd.toISOString().slice(0, 10);
    const dateEntry = byDate.get(dateKey) ?? { total: 0, count: 0 };
    dateEntry.total += score;
    dateEntry.count += 1;
    byDate.set(dateKey, dateEntry);
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
  targetUserId: string
) {
  const user = await resolveAnalyticsTargetUser(requesterId, requesterRole, targetUserId);
  const analytics = await getUserAnalytics(user.id);
  const goalProgress = await getUserGoalProgress(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    goalProgress,
    ...analytics,
  };
}

async function getUserGoalProgress(userId: string) {
  const submissions = await prisma.kpiSubmission.findMany({
    where: {
      userId,
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED, SubmissionStatus.IN_REVIEW] },
    },
    orderBy: { periodEnd: "asc" },
    select: {
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

  const byGoal = new Map<
    string,
    { goalId: string; key: string; name: string; total: number; count: number; order: number }
  >();

  for (const submission of submissions) {
    const scoreResult = computeOverallScore({
      goals: submission.template.goals,
      values: submission.values,
      overallFormula: submission.template.formula,
    });

    scoreResult.goalScores.forEach((goal, index) => {
      if (goal.score === null || goal.score === undefined) {
        return;
      }
      const aggregateKey = goal.key || goal.goalId;
      const existing = byGoal.get(aggregateKey);
      if (!existing) {
        byGoal.set(aggregateKey, {
          goalId: goal.goalId,
          key: goal.key,
          name: goal.name,
          total: goal.score,
          count: 1,
          order: index,
        });
        return;
      }
      existing.total += goal.score;
      existing.count += 1;
    });
  }

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
