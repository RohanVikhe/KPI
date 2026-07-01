import { listUsers, listTeamUsers, updateUser, updateMyProfile, changePassword, deactivateUser, listUserKpiEntries, deleteUserKpiEntry, } from "../services/userService.js";
import { AppError } from "../utils/errors.js";
export async function listUsersHandler(req, res) {
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";
    const users = await listUsers({ activeOnly });
    return res.json({ users });
}
export async function listTeamHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";
    const users = await listTeamUsers(req.user.id, { activeOnly });
    return res.json({ users });
}
export async function updateUserHandler(req, res) {
    const { id } = req.params;
    const user = await updateUser(id, req.body);
    return res.json({ user });
}
export async function updateMyProfileHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { name, email, skills } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : undefined;
    const normalizedSkills = skills === undefined ? undefined : skills.trim().length > 0 ? skills.trim() : null;
    const user = await updateMyProfile(req.user.id, {
        name: typeof name === "string" ? name.trim() : undefined,
        email: normalizedEmail,
        skills: normalizedSkills,
    });
    return res.json({ user });
}
export async function updateMyPasswordHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { currentPassword, newPassword } = req.body;
    await changePassword(req.user.id, currentPassword, newPassword);
    return res.status(204).send();
}
export async function deleteUserHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const user = await deactivateUser(req.user, id);
    return res.json({ user });
}
export async function deleteUserKpiDataHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id, submissionId } = req.params;
    const result = await deleteUserKpiEntry(req.user, id, submissionId);
    return res.json(result);
}
export async function listUserKpiEntriesHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const submissions = await listUserKpiEntries(req.user, id);
    return res.json({ submissions });
}
