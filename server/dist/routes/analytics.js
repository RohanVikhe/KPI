import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateParams, validateQuery } from "../middlewares/validate.js";
import { myAnalyticsHandler, teamAnalyticsHandler, teamMemberAnalyticsHandler, teamMetricTrendHandler, } from "../controllers/analyticsController.js";
const router = Router();
const userIdSchema = z.object({ userId: z.union([z.literal("all"), z.string().cuid()]) });
const metricIdSchema = z.object({ metricId: z.string().cuid() });
const analyticsQuerySchema = z
    .object({
    from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
})
    .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be before or equal to to",
    path: ["from"],
});
router.get("/me", authenticate, validateQuery(analyticsQuerySchema), myAnalyticsHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateQuery(analyticsQuerySchema), teamAnalyticsHandler);
router.get("/team/member/:userId", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateParams(userIdSchema), validateQuery(analyticsQuerySchema), teamMemberAnalyticsHandler);
router.get("/team/metric/:metricId", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateParams(metricIdSchema), validateQuery(analyticsQuerySchema), teamMetricTrendHandler);
export default router;
