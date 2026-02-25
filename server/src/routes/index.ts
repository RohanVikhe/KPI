import { Router } from "express";
import authRoutes from "./auth.js";
import userRoutes from "./users.js";
import templateRoutes from "./templates.js";
import submissionRoutes from "./submissions.js";
import analyticsRoutes from "./analytics.js";
import projectRoutes from "./projects.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/templates", templateRoutes);
router.use("/submissions", submissionRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/projects", projectRoutes);

export default router;
