import type { Request, Response } from "express";
import { AppError } from "../utils/errors.js";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "../services/templateService.js";

export async function listTemplatesHandler(_req: Request, res: Response) {
  const templates = await listTemplates();
  return res.json({ templates });
}

export async function getTemplateHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const template = await getTemplate(id);
  return res.json({ template });
}

export async function createTemplateHandler(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }
  const template = await createTemplate(req.body, req.user.id);
  return res.status(201).json({ template });
}

export async function updateTemplateHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const template = await updateTemplate(id, req.body);
  return res.json({ template });
}

export async function deleteTemplateHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  await deleteTemplate(id);
  return res.status(204).send();
}
