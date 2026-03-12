import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { validateBody, validateParams } from "../middlewares/validate.js";
import {
  listTeamHandler,
  listUsersHandler,
  updateUserHandler,
  updateMyProfileHandler,
  updateMyPasswordHandler,
  deleteUserHandler,
  deleteUserKpiDataHandler,
  listUserKpiEntriesHandler,
} from "../controllers/userController.js";

const router = Router();

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.nativeEnum(Role).optional(),
  managerId: z.string().cuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().email().optional(),
  skills: z.string().trim().max(2000).optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

const idSchema = z.object({
  id: z.string().cuid(),
});

const kpiEntrySchema = z.object({
  id: z.string().cuid(),
  submissionId: z.string().cuid(),
});

router.get("/", authenticate, requireRole(Role.ADMIN), listUsersHandler);
router.get("/team", authenticate, requireRole(Role.MANAGER, Role.ADMIN), listTeamHandler);
router.patch("/me", authenticate, validateBody(profileSchema), updateMyProfileHandler);
router.patch("/me/password", authenticate, validateBody(passwordSchema), updateMyPasswordHandler);
router.get("/:id/kpi", authenticate, requireRole(Role.ADMIN, Role.MANAGER), validateParams(idSchema), listUserKpiEntriesHandler);
router.delete(
  "/:id/kpi/:submissionId",
  authenticate,
  requireRole(Role.ADMIN, Role.MANAGER),
  validateParams(kpiEntrySchema),
  deleteUserKpiDataHandler
);
router.delete("/:id", authenticate, requireRole(Role.ADMIN, Role.MANAGER), validateParams(idSchema), deleteUserHandler);
router.patch("/:id", authenticate, requireRole(Role.ADMIN), validateParams(idSchema), validateBody(updateSchema), updateUserHandler);

export default router;
