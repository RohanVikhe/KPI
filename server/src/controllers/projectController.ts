import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { AppError } from "../utils/errors.js";
import {
  createProjectForUser,
  deleteProject,
  getProject,
  listProjectsForUser,
  updateProject,
} from "../services/projectService.js";

export async function listMyProjectsHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const projects = await listProjectsForUser(req.user.id);
  return res.json({ projects });
}

export async function createMyProjectHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const project = await createProjectForUser(req.user.id, req.body);
  return res.status(201).json({ project });
}

export async function getProjectHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { id } = req.params as { id: string };
  const project = await getProject(id, {
    userId: req.user.id,
    isAdmin: req.user.role === Role.ADMIN,
  });
  return res.json({ project });
}

export async function updateProjectHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { id } = req.params as { id: string };
  const project = await updateProject(id, req.body, {
    userId: req.user.id,
    isAdmin: req.user.role === Role.ADMIN,
  });
  return res.json({ project });
}

export async function deleteProjectHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const { id } = req.params as { id: string };
  await deleteProject(id, {
    userId: req.user.id,
    isAdmin: req.user.role === Role.ADMIN,
  });
  return res.status(204).send();
}
