import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
export async function listUsers() {
    return prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true, createdAt: true },
    });
}
export async function listTeamUsers(managerId) {
    return prisma.user.findMany({
        where: { managerId },
        select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true },
    });
}
export async function updateUser(id, input) {
    if (input.managerId) {
        const manager = await prisma.user.findUnique({ where: { id: input.managerId } });
        if (!manager) {
            throw new AppError("Manager not found", 404, "MANAGER_NOT_FOUND");
        }
    }
    return prisma.user.update({
        where: { id },
        data: {
            name: input.name ?? undefined,
            role: input.role ?? undefined,
            managerId: input.managerId === undefined ? undefined : input.managerId,
            isActive: input.isActive === undefined ? undefined : input.isActive,
        },
        select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true },
    });
}
