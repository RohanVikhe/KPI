import { listUsers, listTeamUsers, updateUser } from "../services/userService.js";
import { AppError } from "../utils/errors.js";
export async function listUsersHandler(_req, res) {
    const users = await listUsers();
    return res.json({ users });
}
export async function listTeamHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const users = await listTeamUsers(req.user.id);
    return res.json({ users });
}
export async function updateUserHandler(req, res) {
    const { id } = req.params;
    const user = await updateUser(id, req.body);
    return res.json({ user });
}
