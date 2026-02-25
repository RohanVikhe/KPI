import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { validateBody } from "../middlewares/validate.js";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { bootstrapHandler, loginHandler, meHandler, registerHandler } from "../controllers/authController.js";
const router = Router();
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});
const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.nativeEnum(Role),
    managerId: z.string().cuid().optional().nullable(),
});
const bootstrapSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
});
router.post("/login", validateBody(loginSchema), loginHandler);
router.post("/bootstrap", validateBody(bootstrapSchema), bootstrapHandler);
router.post("/register", authenticate, requireRole(Role.ADMIN), validateBody(registerSchema), registerHandler);
router.get("/me", authenticate, meHandler);
export default router;
