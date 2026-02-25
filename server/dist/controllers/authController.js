import { prisma } from "../db/prisma.js";
import { Role } from "@prisma/client";
import { AppError } from "../utils/errors.js";
import { login, register } from "../services/authService.js";
export async function loginHandler(req, res) {
    const { email, password } = req.body;
    const result = await login(email, password);
    return res.json(result);
}
export async function registerHandler(req, res) {
    const user = await register(req.body);
    return res.status(201).json({ user });
}
export async function bootstrapHandler(req, res) {
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
        throw new AppError("Bootstrap already completed", 403, "BOOTSTRAP_LOCKED");
    }
    const user = await register({ ...req.body, role: Role.ADMIN });
    return res.status(201).json({ user });
}
export async function meHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true },
    });
    return res.json({ user });
}
