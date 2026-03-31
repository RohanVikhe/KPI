import type { Request, Response } from "express";
import { AppError } from "../utils/errors.js";
import {
  getTeamAnalytics,
  getTeamCombinedMemberAnalytics,
  getTeamMemberAnalytics,
  getTeamMetricTrend,
  getUserAnalytics,
  type AnalyticsDateRange,
} from "../services/analyticsService.js";

function parseAnalyticsDateRange(req: Request): AnalyticsDateRange {
  const query = req.query as { from?: string; to?: string };
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;

  if (from && Number.isNaN(from.getTime())) {
    throw new AppError("Invalid from date", 400, "DATE_RANGE_INVALID");
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new AppError("Invalid to date", 400, "DATE_RANGE_INVALID");
  }
  if (from && to && from > to) {
    throw new AppError("From date must be before or equal to to date", 400, "DATE_RANGE_INVALID");
  }

  return { from, to };
}

export async function myAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const analytics = await getUserAnalytics(req.user.id, parseAnalyticsDateRange(req));
  return res.json({ analytics });
}

export async function teamAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const analytics = await getTeamAnalytics(req.user.id, req.user.role, parseAnalyticsDateRange(req));
  return res.json({ analytics });
}

export async function teamMemberAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { userId } = req.params as { userId: string };
  const analytics =
    userId === "all"
      ? await getTeamCombinedMemberAnalytics(req.user.id, req.user.role, parseAnalyticsDateRange(req))
      : await getTeamMemberAnalytics(req.user.id, req.user.role, userId, parseAnalyticsDateRange(req));
  return res.json({ analytics });
}

export async function teamMetricTrendHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { metricId } = req.params as { metricId: string };
  const metricTrend = await getTeamMetricTrend(req.user.id, req.user.role, metricId, parseAnalyticsDateRange(req));
  return res.json({ metricTrend });
}
