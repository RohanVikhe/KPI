import { AppError } from "../utils/errors.js";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "../services/templateService.js";
export async function listTemplatesHandler(_req, res) {
    const templates = await listTemplates();
    return res.json({ templates });
}
export async function getTemplateHandler(req, res) {
    const { id } = req.params;
    const template = await getTemplate(id);
    return res.json({ template });
}
export async function createTemplateHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const template = await createTemplate(req.body, req.user.id);
    return res.status(201).json({ template });
}
export async function updateTemplateHandler(req, res) {
    const { id } = req.params;
    const template = await updateTemplate(id, req.body);
    return res.json({ template });
}
export async function deleteTemplateHandler(req, res) {
    const { id } = req.params;
    await deleteTemplate(id);
    return res.status(204).send();
}
