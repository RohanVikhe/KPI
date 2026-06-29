import { Router } from "express";
import { authenticate } from "../middlewares/auth.js";
import { getInsights, getSnapshotInsights } from "./aiController.js";
export const aiRouter = Router();
// All AI routes require authentication
aiRouter.use(authenticate);
// Full submission insight (used on Submission Detail page)
aiRouter.get("/submissions/:id/insights", getInsights);
// Snapshot insight from metric data posted directly (used on Analytics page)
aiRouter.post("/snapshot-insights", getSnapshotInsights);
