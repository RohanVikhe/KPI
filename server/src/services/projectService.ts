import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";

type ProjectInput = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  totalTickets?: number;
  doneTickets?: number;
  overdueTickets?: number;
  changeRequestTickets?: number;
};

export type ProjectTicketCounts = {
  total: number;
  done: number;
  overdue: number;
  changeRequests: number;
};

type ProjectRecord = {
  id: string;
  userId?: string;
  name: string;
  description: string | null;
  isActive: boolean;
  totalTickets: number;
  doneTickets: number;
  overdueTickets: number;
  changeRequestTickets: number;
  createdAt: Date;
  updatedAt: Date;
};

function sanitizeCount(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function buildCountUpdate(input: ProjectInput) {
  return {
    totalTickets: sanitizeCount(input.totalTickets),
    doneTickets: sanitizeCount(input.doneTickets),
    overdueTickets: sanitizeCount(input.overdueTickets),
    changeRequestTickets: sanitizeCount(input.changeRequestTickets),
  };
}

function extractTicketCounts(project: {
  totalTickets: number;
  doneTickets: number;
  overdueTickets: number;
  changeRequestTickets: number;
}): ProjectTicketCounts {
  return {
    total: project.totalTickets,
    done: project.doneTickets,
    overdue: project.overdueTickets,
    changeRequests: project.changeRequestTickets,
  };
}

function shapeProjectWithCounts(project: ProjectRecord) {
  const {
    totalTickets,
    doneTickets,
    overdueTickets,
    changeRequestTickets,
    userId: _userId,
    ...baseProject
  } = project;

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

async function getProjectForAccess(
  projectId: string,
  options: { userId: string; isAdmin: boolean }
) {
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

export async function ensureProjectAccess(
  projectId: string,
  options: { userId: string; isAdmin: boolean }
) {
  return getProjectForAccess(projectId, options);
}

export async function listProjectsForUser(userId: string) {
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

  return projects.map((project) =>
    shapeProjectWithCounts(project)
  );
}

export async function createProjectForUser(
  userId: string,
  input: ProjectInput
) {
  const name = input.name?.trim();
  if (!name)
    throw new AppError(
      "Project name required",
      400,
      "PROJECT_NAME_REQUIRED"
    );

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

export async function getProject(
  projectId: string,
  options: { userId: string; isAdmin: boolean }
) {
  const project = await getProjectForAccess(projectId, options);
  return shapeProjectWithCounts(project);
}

export async function updateProject(
  projectId: string,
  input: ProjectInput,
  options: { userId: string; isAdmin: boolean }
) {
  await getProjectForAccess(projectId, options);
  const counts = buildCountUpdate(input);

  const updated = await prisma.userProject.update({
    where: { id: projectId },
    data: {
      name: input.name?.trim(),
      description:
        input.description === undefined
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

export async function deleteProject(
  projectId: string,
  options: { userId: string; isAdmin: boolean }
) {
  await getProjectForAccess(projectId, options);

  await prisma.userProject.delete({
    where: { id: projectId },
  });

  return { id: projectId };
}
