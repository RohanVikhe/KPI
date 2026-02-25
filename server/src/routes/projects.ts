import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.js";
import { validateBody, validateParams } from "../middlewares/validate.js";
import {
  createMyProjectHandler,
  deleteProjectHandler,
  getProjectHandler,
  listMyProjectsHandler,
  updateProjectHandler,
} from "../controllers/projectController.js";

const router = Router();

const projectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  totalTickets: z.number().int().min(0).optional(),
  doneTickets: z.number().int().min(0).optional(),
  overdueTickets: z.number().int().min(0).optional(),
  changeRequestTickets: z.number().int().min(0).optional(),
});

const projectUpdateSchema = projectSchema.partial();

const idSchema = z.object({ id: z.string().cuid() });

router.get("/me", authenticate, listMyProjectsHandler);
router.post("/me", authenticate, validateBody(projectSchema), createMyProjectHandler);
router.get("/:id", authenticate, validateParams(idSchema), getProjectHandler);
router.patch("/:id", authenticate, validateParams(idSchema), validateBody(projectUpdateSchema), updateProjectHandler);
router.delete("/:id", authenticate, validateParams(idSchema), deleteProjectHandler);

export default router;
