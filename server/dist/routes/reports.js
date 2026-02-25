import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.js";
import { validateParams } from "../middlewares/validate.js";
import { downloadReportHandler } from "../controllers/reportController.js";
const router = Router();
const idSchema = z.object({ id: z.string().cuid() });
router.get("/:id/download", authenticate, validateParams(idSchema), downloadReportHandler);
export default router;
