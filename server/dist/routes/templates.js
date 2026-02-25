import { Router } from "express";
import { z } from "zod";
import { MetricType, Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateBody, validateParams } from "../middlewares/validate.js";
import { createTemplateHandler, getTemplateHandler, listTemplatesHandler, updateTemplateHandler, } from "../controllers/templateController.js";
const router = Router();
const metricSchema = z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/i),
    label: z.string().min(2),
    type: z.nativeEnum(MetricType),
    required: z.boolean().optional(),
    min: z.number().optional().nullable(),
    max: z.number().optional().nullable(),
    weight: z.number().optional().nullable(),
    order: z.number().int().optional().nullable(),
});
const templateSchema = z.object({
    name: z.string().min(3),
    description: z.string().optional().nullable(),
    formula: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    metrics: z.array(metricSchema).min(1),
});
const templateUpdateSchema = templateSchema.partial();
const idSchema = z.object({ id: z.string().cuid() });
router.get("/", authenticate, listTemplatesHandler);
router.get("/:id", authenticate, validateParams(idSchema), getTemplateHandler);
router.post("/", authenticate, requireRole(Role.ADMIN), validateBody(templateSchema), createTemplateHandler);
router.put("/:id", authenticate, requireRole(Role.ADMIN), validateParams(idSchema), validateBody(templateUpdateSchema), updateTemplateHandler);
export default router;
