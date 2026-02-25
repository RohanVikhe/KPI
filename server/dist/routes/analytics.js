import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { myAnalyticsHandler, teamAnalyticsHandler } from "../controllers/analyticsController.js";
const router = Router();
router.get("/me", authenticate, myAnalyticsHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), teamAnalyticsHandler);
export default router;
