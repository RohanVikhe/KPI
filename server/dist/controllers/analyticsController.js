import { AppError } from "../utils/errors.js";
import { getTeamAnalytics, getUserAnalytics } from "../services/analyticsService.js";
export async function myAnalyticsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const analytics = await getUserAnalytics(req.user.id);
    return res.json({ analytics });
}
export async function teamAnalyticsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const analytics = await getTeamAnalytics(req.user.id, req.user.role);
    return res.json({ analytics });
}
