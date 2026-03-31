import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
export async function login(email, password) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
        throw new AppError("Invalid credentials", 401, "AUTH_INVALID");
    }
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
        throw new AppError("Invalid credentials", 401, "AUTH_INVALID");
    }
    const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
        subject: user.id,
        expiresIn: env.JWT_EXPIRES_IN,
    });
    return {
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            managerId: user.managerId,
            isActive: user.isActive,
            skills: user.skills,
        },
    };
}
export async function register(input) {
    if (input.role === Role.ADMIN && input.managerId) {
        throw new AppError("Admin cannot have a manager", 400, "ADMIN_MANAGER_NOT_ALLOWED");
    }
    const managerId = input.role === Role.ADMIN ? null : input.managerId ?? null;
    if (managerId) {
        const manager = await prisma.user.findUnique({ where: { id: managerId } });
        if (!manager) {
            throw new AppError("Manager not found", 404, "MANAGER_NOT_FOUND");
        }
        const allowedRoles = [Role.MANAGER, Role.ADMIN];
        if (!allowedRoles.includes(manager.role)) {
            throw new AppError("Assigned manager must be a manager or admin", 400, "MANAGER_INVALID");
        }
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
        data: {
            name: input.name,
            email: input.email,
            passwordHash,
            role: input.role,
            managerId,
        },
    });
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        managerId: user.managerId,
        isActive: user.isActive,
        skills: user.skills,
    };
}
