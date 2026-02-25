import { Router } from "express";
import { z } from "zod";
import { ReviewStatus, Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateBody, validateParams } from "../middlewares/validate.js";
import { createSubmissionHandler, addCommentHandler, generateReportHandler, getSubmissionHandler, listAllSubmissionsHandler, listMySubmissionsHandler, listTeamSubmissionsHandler, listReportsHandler, reviewSubmissionHandler, } from "../controllers/submissionController.js";
const router = Router();
const submissionSchema = z.object({
    templateId: z.string().cuid(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    values: z
        .array(z.object({
        metricId: z.string().cuid(),
        valueNumber: z.number(),
        valueText: z.string().optional().nullable(),
    }))
        .min(1),
});
const idSchema = z.object({ id: z.string().cuid() });
const reviewSchema = z.object({
    status: z.nativeEnum(ReviewStatus),
    comment: z.string().optional().nullable(),
});
const commentSchema = z.object({
    message: z.string().min(1),
});
router.post("/", authenticate, validateBody(submissionSchema), createSubmissionHandler);
router.get("/me", authenticate, listMySubmissionsHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), listTeamSubmissionsHandler);
router.get("/all", authenticate, requireRole(Role.ADMIN), listAllSubmissionsHandler);
router.get("/:id", authenticate, validateParams(idSchema), getSubmissionHandler);
router.post("/:id/comments", authenticate, validateParams(idSchema), validateBody(commentSchema), addCommentHandler);
router.post("/:id/review", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateParams(idSchema), validateBody(reviewSchema), reviewSubmissionHandler);
router.post("/:id/report", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateParams(idSchema), generateReportHandler);
router.get("/:id/reports", authenticate, requireRole(Role.MANAGER, Role.ADMIN), validateParams(idSchema), listReportsHandler);
export default router;
