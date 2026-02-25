import type { Request, Response } from "express";
import { AppError } from "../utils/errors.js";
import { getTeamAnalytics, getTeamMemberAnalytics, getUserAnalytics } from "../services/analyticsService.js";

export async function myAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const analytics = await getUserAnalytics(req.user.id);
  return res.json({ analytics });
}

export async function teamAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const analytics = await getTeamAnalytics(req.user.id, req.user.role);
  return res.json({ analytics });
}

export async function teamMemberAnalyticsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { userId } = req.params as { userId: string };
  const analytics = await getTeamMemberAnalytics(req.user.id, req.user.role, userId);
  return res.json({ analytics });
}
