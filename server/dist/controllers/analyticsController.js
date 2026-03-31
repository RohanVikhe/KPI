import { AppError } from "../utils/errors.js";
import { getTeamAnalytics, getTeamCombinedMemberAnalytics, getTeamMemberAnalytics, getTeamMetricTrend, getUserAnalytics, } from "../services/analyticsService.js";
function parseAnalyticsDateRange(req) {
    const query = req.query;
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
export async function myAnalyticsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const analytics = await getUserAnalytics(req.user.id, parseAnalyticsDateRange(req));
    return res.json({ analytics });
}
export async function teamAnalyticsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const analytics = await getTeamAnalytics(req.user.id, req.user.role, parseAnalyticsDateRange(req));
    return res.json({ analytics });
}
export async function teamMemberAnalyticsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { userId } = req.params;
    const analytics = userId === "all"
        ? await getTeamCombinedMemberAnalytics(req.user.id, req.user.role, parseAnalyticsDateRange(req))
        : await getTeamMemberAnalytics(req.user.id, req.user.role, userId, parseAnalyticsDateRange(req));
    return res.json({ analytics });
}
export async function teamMetricTrendHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { metricId } = req.params;
    const metricTrend = await getTeamMetricTrend(req.user.id, req.user.role, metricId, parseAnalyticsDateRange(req));
    return res.json({ metricTrend });
}
