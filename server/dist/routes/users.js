import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateBody, validateParams } from "../middlewares/validate.js";
import { listTeamHandler, listUsersHandler, updateUserHandler } from "../controllers/userController.js";
const router = Router();
const updateSchema = z.object({
    name: z.string().min(2).optional(),
    role: z.nativeEnum(Role).optional(),
    managerId: z.string().cuid().nullable().optional(),
    isActive: z.boolean().optional(),
});
const idSchema = z.object({
    id: z.string().cuid(),
});
router.get("/", authenticate, requireRole(Role.ADMIN), listUsersHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), listTeamHandler);
router.patch("/:id", authenticate, requireRole(Role.ADMIN), validateParams(idSchema), validateBody(updateSchema), updateUserHandler);
export default router;
