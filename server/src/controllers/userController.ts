import type { Request, Response } from "express";
import {
  listUsers,
  listTeamUsers,
  updateUser,
  updateMyProfile,
  changePassword,
  deactivateUser,
  listUserKpiEntries,
  deleteUserKpiEntry,
} from "../services/userService.js";
import { AppError } from "../utils/errors.js";

export async function listUsersHandler(_req: Request, res: Response) {
  const users = await listUsers();
  return res.json({ users });
}

export async function listTeamHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const users = await listTeamUsers(req.user.id);
  return res.json({ users });
}

export async function updateUserHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const user = await updateUser(id, req.body);
  return res.json({ user });
}

export async function updateMyProfileHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const { name, email, skills } = req.body as { name?: string; email?: string; skills?: string };
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : undefined;
  const normalizedSkills =
    skills === undefined ? undefined : skills.trim().length > 0 ? skills.trim() : null;

  const user = await updateMyProfile(req.user.id, {
    name: typeof name === "string" ? name.trim() : undefined,
    email: normalizedEmail,
    skills: normalizedSkills,
  });
  return res.json({ user });
}

export async function updateMyPasswordHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await changePassword(req.user.id, currentPassword, newPassword);
  return res.status(204).send();
}

export async function deleteUserHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const { id } = req.params as { id: string };
  const user = await deactivateUser(req.user, id);
  return res.json({ user });
}

export async function deleteUserKpiDataHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const { id, submissionId } = req.params as { id: string; submissionId: string };
  const result = await deleteUserKpiEntry(req.user, id, submissionId);
  return res.json(result);
}

export async function listUserKpiEntriesHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const { id } = req.params as { id: string };
  const submissions = await listUserKpiEntries(req.user, id);
  return res.json({ submissions });
}
