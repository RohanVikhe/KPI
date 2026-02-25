import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateParams } from "../middlewares/validate.js";
import {
  myAnalyticsHandler,
  teamAnalyticsHandler,
  teamMemberAnalyticsHandler,
} from "../controllers/analyticsController.js";

const router = Router();
const userIdSchema = z.object({ userId: z.string().cuid() });

router.get("/me", authenticate, myAnalyticsHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), teamAnalyticsHandler);
router.get(
  "/team/member/:userId",
  authenticate,
  requireRole(Role.MANAGER, Role.ADMIN),
  validateParams(userIdSchema),
  teamMemberAnalyticsHandler
);

export default router;
