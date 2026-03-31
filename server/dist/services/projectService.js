import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
function sanitizeCount(value) {
    if (value === undefined)
        return undefined;
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.floor(value));
}
function buildCountUpdate(input) {
    return {
        totalTickets: sanitizeCount(input.totalTickets),
        doneTickets: sanitizeCount(input.doneTickets),
        overdueTickets: sanitizeCount(input.overdueTickets),
        changeRequestTickets: sanitizeCount(input.changeRequestTickets),
    };
}
function extractTicketCounts(project) {
    return {
        total: project.totalTickets,
        done: project.doneTickets,
        overdue: project.overdueTickets,
        changeRequests: project.changeRequestTickets,
    };
}
function shapeProjectWithCounts(project) {
    const { totalTickets, doneTickets, overdueTickets, changeRequestTickets, userId: _userId, ...baseProject } = project;
    return {
        ...baseProject,
        ticketCounts: extractTicketCounts({
            totalTickets,
            doneTickets,
            overdueTickets,
            changeRequestTickets,
        }),
    };
}
async function getProjectForAccess(projectId, options) {
    const project = await prisma.userProject.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            userId: true,
            name: true,
            description: true,
            isActive: true,
            totalTickets: true,
            doneTickets: true,
            overdueTickets: true,
            changeRequestTickets: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    if (!project)
        throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
    if (!options.isAdmin && project.userId !== options.userId)
        throw new AppError("Forbidden", 403, "FORBIDDEN");
    return project;
}
export async function ensureProjectAccess(projectId, options) {
    return getProjectForAccess(projectId, options);
}
export async function listProjectsForUser(userId) {
    const projects = await prisma.userProject.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            totalTickets: true,
            doneTickets: true,
            overdueTickets: true,
            changeRequestTickets: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    return projects.map((project) => shapeProjectWithCounts(project));
}
export async function createProjectForUser(userId, input) {
    const name = input.name?.trim();
    if (!name)
        throw new AppError("Project name required", 400, "PROJECT_NAME_REQUIRED");
    const counts = buildCountUpdate(input);
    const created = await prisma.userProject.create({
        data: {
            userId,
            name,
            description: input.description?.trim() || null,
            isActive: input.isActive ?? true,
            totalTickets: counts.totalTickets ?? 0,
            doneTickets: counts.doneTickets ?? 0,
            overdueTickets: counts.overdueTickets ?? 0,
            changeRequestTickets: counts.changeRequestTickets ?? 0,
        },
        select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            totalTickets: true,
            doneTickets: true,
            overdueTickets: true,
            changeRequestTickets: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    return shapeProjectWithCounts(created);
}
export async function getProject(projectId, options) {
    const project = await getProjectForAccess(projectId, options);
    return shapeProjectWithCounts(project);
}
export async function updateProject(projectId, input, options) {
    await getProjectForAccess(projectId, options);
    const counts = buildCountUpdate(input);
    const updated = await prisma.userProject.update({
        where: { id: projectId },
        data: {
            name: input.name?.trim(),
            description: input.description === undefined
                ? undefined
                : input.description?.trim() || null,
            isActive: input.isActive,
            totalTickets: counts.totalTickets,
            doneTickets: counts.doneTickets,
            overdueTickets: counts.overdueTickets,
            changeRequestTickets: counts.changeRequestTickets,
        },
        select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            totalTickets: true,
            doneTickets: true,
            overdueTickets: true,
            changeRequestTickets: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    return shapeProjectWithCounts(updated);
}
export async function deleteProject(projectId, options) {
    await getProjectForAccess(projectId, options);
    await prisma.userProject.delete({
        where: { id: projectId },
    });
    return { id: projectId };
}
