import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { Role, SubmissionStatus, User } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";

type CreateUserPayload = {
  name: string;
  email: string;
  password: string;
  role?: Role;
  managerId?: string | null;
};

type UserKpiEntry = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: SubmissionStatus;
  score?: number | null;
  submittedAt: string;
  template: {
    id: string;
    name: string;
  };
};

type UserSortKey = "name" | "role" | "manager" | "status";

const USERS_PAGE_SIZE = 12;

function projectSummary(projects?: { name: string }[]) {
  if (!projects || projects.length === 0) return "--";
  const names = projects.map((project) => project.name);
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER";

  const { data, isLoading, error } = useQuery({
    queryKey: ["users", isAdmin ? "all" : "team"],
    queryFn: () => apiFetch<{ users: User[] }>(isAdmin ? "/users" : "/users/team"),
    enabled: Boolean(user),
  });

  const users = data?.users ?? [];

  const managers = useMemo(
    () => users.filter((item) => item.role === "MANAGER" || item.role === "ADMIN"),
    [users]
  );

  const [form, setForm] = useState<CreateUserPayload>({
    name: "",
    email: "",
    password: "",
    role: "EMPLOYEE",
    managerId: null,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);
  const [managingKpiUser, setManagingKpiUser] = useState<User | null>(null);
  const [deletingKpiEntryId, setDeletingKpiEntryId] = useState<string | null>(null);
  const [updatingAccessId, setUpdatingAccessId] = useState<string | null>(null);
  const [roleDraftByUserId, setRoleDraftByUserId] = useState<Record<string, Role>>({});
  const [managerDraftByUserId, setManagerDraftByUserId] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [sortKey, setSortKey] = useState<UserSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [usersPage, setUsersPage] = useState(1);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const {
    data: userKpiEntriesData,
    isLoading: isUserKpiEntriesLoading,
    error: userKpiEntriesError,
  } = useQuery({
    queryKey: ["users", "kpi-entries", managingKpiUser?.id],
    queryFn: () => apiFetch<{ submissions: UserKpiEntry[] }>(`/users/${managingKpiUser!.id}/kpi`),
    enabled: Boolean(managingKpiUser?.id),
  });

  const userKpiEntries = userKpiEntriesData?.submissions ?? [];

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const formatValidationError = (details: unknown) => {
    if (!Array.isArray(details)) {
      return "";
    }
    const messages = details
      .map((issue) => {
        if (!issue || typeof issue !== "object") {
          return null;
        }
        const path = Array.isArray((issue as any).path) ? (issue as any).path.join(".") : "";
        const message = typeof (issue as any).message === "string" ? (issue as any).message : "Invalid value";
        return path ? `${path}: ${message}` : message;
      })
      .filter(Boolean);

    if (messages.length === 0) {
      return "";
    }
    return `Validation failed: ${messages.join("; ")}`;
  };

  const mutation = useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      apiFetch<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      const message = "User created successfully.";
      showToast("success", message);
      setForm({ name: "", email: "", password: "", role: "EMPLOYEE", managerId: null });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const validation = formatValidationError(err.details);
        const message = validation || err.message || "Failed to create user.";
        showToast("error", message);
        return;
      }
      showToast("error", "Failed to create user.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/users/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      const message = "User deactivated.";
      showToast("success", message);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const message = err.message || "Failed to deactivate user.";
        showToast("error", message);
        return;
      }
      showToast("error", "Failed to deactivate user.");
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch<{ user: User }>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (_data, variables) => {
      showToast("success", variables.isActive ? "User activated." : "User deactivated.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const message = err.message || "Failed to update user status.";
        showToast("error", message);
        return;
      }
      showToast("error", "Failed to update user status.");
    },
  });

  const deleteKpiEntryMutation = useMutation({
    mutationFn: ({ userId, submissionId }: { userId: string; submissionId: string }) =>
      apiFetch<{ deletedSubmissionId: string }>(`/users/${userId}/kpi/${submissionId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, variables) => {
      showToast("success", "KPI entry deleted.");
      queryClient.invalidateQueries({ queryKey: ["users", "kpi-entries", variables.userId] });
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const message = err.message || "Failed to delete KPI entry.";
        showToast("error", message);
        return;
      }
      showToast("error", "Failed to delete KPI entry.");
    },
  });

  const updateAccessMutation = useMutation({
    mutationFn: ({ id, role, managerId }: { id: string; role: Role; managerId: string | null }) =>
      apiFetch<{ user: User }>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, managerId }),
      }),
    onSuccess: (_data, variables) => {
      showToast("success", "User access updated.");
      setRoleDraftByUserId((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      setManagerDraftByUserId((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const message = err.message || "Failed to update user access.";
        showToast("error", message);
        return;
      }
      showToast("error", "Failed to update user access.");
    },
  });

  const handleChange = (key: keyof CreateUserPayload, value: string) => {
    if (key === "managerId") {
      setForm((prev) => ({ ...prev, managerId: value ? value : null }));
      return;
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.password) {
      const message = "Name, email, and password are required.";
      showToast("error", message);
      return;
    }

    if (form.password.length < 8) {
      const message = "Password must be at least 8 characters.";
      showToast("error", message);
      return;
    }

    if (isAdmin) {
      mutation.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        managerId: form.role === "ADMIN" ? null : form.managerId ? form.managerId : null,
      });
      return;
    }

    if (isManager) {
      mutation.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
    }
  };

  const handleDelete = (target: User) => {
    if (!window.confirm(`Deactivate ${target.name}?`)) {
      return;
    }
    setDeletingId(target.id);
    deleteMutation.mutate(target.id, {
      onSettled: () => setDeletingId(null),
    });
  };

  const handleToggleActive = (target: User, isActive: boolean) => {
    const action = isActive ? "activate" : "deactivate";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${target.name}?`)) {
      return;
    }
    setTogglingActiveId(target.id);
    toggleActiveMutation.mutate(
      { id: target.id, isActive },
      {
        onSettled: () => setTogglingActiveId(null),
      }
    );
  };

  const handleManageKpi = (target: User) => {
    setManagingKpiUser(target);
  };

  const handleDeleteKpiEntry = (entry: UserKpiEntry) => {
    if (!managingKpiUser) {
      return;
    }

    const periodLabel = `${formatDate(entry.periodStart)} - ${formatDate(entry.periodEnd)}`;
    if (!window.confirm(`Delete KPI entry "${entry.template.name}" (${periodLabel}) for ${managingKpiUser.name}?`)) {
      return;
    }

    setDeletingKpiEntryId(entry.id);
    deleteKpiEntryMutation.mutate(
      {
        userId: managingKpiUser.id,
        submissionId: entry.id,
      },
      {
        onSettled: () => setDeletingKpiEntryId(null),
      }
    );
  };

  const handleManagerDraftChange = (targetId: string, managerId: string) => {
    setManagerDraftByUserId((prev) => ({ ...prev, [targetId]: managerId }));
  };

  const handleRoleDraftChange = (targetId: string, role: Role) => {
    setRoleDraftByUserId((prev) => ({ ...prev, [targetId]: role }));
  };

  const handleAccessSave = (target: User) => {
    const selectedRole = roleDraftByUserId[target.id] ?? target.role;
    const selectedManagerId = managerDraftByUserId[target.id] ?? (target.managerId ?? "");
    const normalizedManagerId =
      selectedRole === "ADMIN" ? "" : selectedManagerId.trim();
    const currentManagerId = (target.managerId ?? "").trim();
    if (selectedRole === target.role && normalizedManagerId === currentManagerId) {
      return;
    }
    setUpdatingAccessId(target.id);
    updateAccessMutation.mutate(
      {
        id: target.id,
        role: selectedRole,
        managerId: selectedRole === "ADMIN" ? null : normalizedManagerId || null,
      },
      {
        onSettled: () => setUpdatingAccessId(null),
      }
    );
  };

  const toggleSort = (key: UserSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortIndicator = (key: UserSortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ^" : " v";
  };

  const managersById = useMemo(() => new Map(managers.map((item) => [item.id, item])), [managers]);

  const userStats = useMemo(() => {
    const active = users.filter((item) => item.isActive).length;
    const employees = users.filter((item) => item.role === "EMPLOYEE").length;
    const managerCount = users.filter((item) => item.role === "MANAGER").length;
    const admins = users.filter((item) => item.role === "ADMIN").length;
    return {
      total: users.length,
      active,
      inactive: users.length - active,
      employees,
      managers: managerCount,
      admins,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((item) => {
      if (roleFilter !== "ALL" && item.role !== roleFilter) return false;
      if (statusFilter === "ACTIVE" && !item.isActive) return false;
      if (statusFilter === "INACTIVE" && item.isActive) return false;
      if (!query) return true;
      const managerName = item.managerId ? managersById.get(item.managerId)?.name ?? "" : "";
      const haystack = `${item.name} ${item.email} ${item.role} ${managerName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [users, searchQuery, roleFilter, statusFilter, managersById]);

  const sortedUsers = useMemo(() => {
    const roleOrder: Record<Role, number> = {
      ADMIN: 0,
      MANAGER: 1,
      EMPLOYEE: 2,
    };

    const managerLabel = (item: User) => {
      if (item.role === "ADMIN") return "n/a (admin)";
      if (!item.managerId) return "unassigned";
      return (managersById.get(item.managerId)?.name ?? "unassigned").toLowerCase();
    };

    const sorted = [...filteredUsers].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortKey === "role") {
        comparison = roleOrder[a.role] - roleOrder[b.role];
      } else if (sortKey === "manager") {
        comparison = managerLabel(a).localeCompare(managerLabel(b));
      } else if (sortKey === "status") {
        comparison = Number(b.isActive) - Number(a.isActive);
      }

      if (comparison === 0) {
        comparison = a.name.localeCompare(b.name);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [filteredUsers, sortKey, sortDirection, managersById]);

  const totalUsersPages = useMemo(
    () => Math.max(1, Math.ceil(sortedUsers.length / USERS_PAGE_SIZE)),
    [sortedUsers.length]
  );

  const visibleUsers = useMemo(() => {
    const start = (usersPage - 1) * USERS_PAGE_SIZE;
    return sortedUsers.slice(start, start + USERS_PAGE_SIZE);
  }, [sortedUsers, usersPage]);

  useEffect(() => {
    setUsersPage(1);
  }, [searchQuery, roleFilter, statusFilter, sortKey, sortDirection]);

  useEffect(() => {
    if (usersPage > totalUsersPages) {
      setUsersPage(totalUsersPages);
    }
  }, [usersPage, totalUsersPages]);

  if (isLoading) {
    return <div className="panel">Loading users...</div>;
  }

  if (error) {
    return <div className="panel">Unable to load users.</div>;
  }

  return (
    <div className="page">
      {toast && (
        <MessageToast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      <form className="panel form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h3>Create User</h3>
          <span className="panel-sub">Invite new team members to KPI Pulse.</span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => handleChange("name", event.target.value)} />
          </label>
          <label className="form-field">
            <span>Email</span>
            <input value={form.email} onChange={(event) => handleChange("email", event.target.value)} />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              minLength={8}
              placeholder="Minimum 8 characters"
              onChange={(event) => handleChange("password", event.target.value)}
            />
          </label>
          {isAdmin && (
            <label className="form-field">
              <span>Role</span>
              <select value={form.role} onChange={(event) => handleChange("role", event.target.value)}>
                <option value="EMPLOYEE">EMPLOYEE</option>
                <option value="MANAGER">MANAGER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
          )}
          {isAdmin && form.role !== "ADMIN" && (
            <label className="form-field">
              <span>Manager</span>
              <select
                value={form.managerId ?? ""}
                onChange={(event) => handleChange("managerId", event.target.value || "")}
              >
                <option value="">No manager</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name} ({manager.role})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating..." : "Create user"}
        </button>
      </form>

      <div className="panel">
        <div className="panel-header">
          <h3>{isAdmin ? "All Users" : "My Team"}</h3>
          <span className="panel-sub">
            {isAdmin
              ? `Directory view for ${userStats.total} accounts`
              : `Team view for ${filteredUsers.length} member${filteredUsers.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {isAdmin && (
          <div className="users-stats-grid">
            <div className="users-stat-card">
              <div className="users-stat-label">Total Users</div>
              <div className="users-stat-value">{userStats.total}</div>
            </div>
            <div className="users-stat-card">
              <div className="users-stat-label">Active</div>
              <div className="users-stat-value">{userStats.active}</div>
            </div>
            <div className="users-stat-card">
              <div className="users-stat-label">Employees</div>
              <div className="users-stat-value">{userStats.employees}</div>
            </div>
            <div className="users-stat-card">
              <div className="users-stat-label">Managers / Admins</div>
              <div className="users-stat-value">
                {userStats.managers} / {userStats.admins}
              </div>
            </div>
          </div>
        )}

        <div className="users-filter-bar">
          <label className="form-field">
            <span>Search</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find by name, email, role, or manager"
            />
          </label>
          <label className="form-field">
            <span>Role</span>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as Role | "ALL")}
            >
              <option value="ALL">All roles</option>
              <option value="EMPLOYEE">Employee</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <label className="form-field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
            >
              <option value="ALL">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <div className="users-table-wrap">
          <div className="table users-table-grid">
            <div className="table-row table-header users-table">
              <div>
                <button className="table-sort" type="button" onClick={() => toggleSort("name")}>
                  User{sortIndicator("name")}
                </button>
              </div>
              <div>
                <button className="table-sort" type="button" onClick={() => toggleSort("role")}>
                  Role{sortIndicator("role")}
                </button>
              </div>
              <div>
                <button className="table-sort" type="button" onClick={() => toggleSort("manager")}>
                  Manager{sortIndicator("manager")}
                </button>
              </div>
              <div>Projects</div>
              <div>
                <button className="table-sort" type="button" onClick={() => toggleSort("status")}>
                  Status{sortIndicator("status")}
                </button>
              </div>
              <div>Actions</div>
            </div>
            {visibleUsers.map((item) => {
              const initials = getInitials(item.name);
              const isSelf = user?.id === item.id;
              const canAdminToggleActive = isAdmin && !isSelf;
              const canManagerDeactivate =
                item.isActive && isManager && item.role === "EMPLOYEE" && item.managerId === user?.id;
              const canManageKpi = isAdmin || (isManager && item.role === "EMPLOYEE" && item.managerId === user?.id);
              const canEditAccess = isAdmin && !isSelf;
              const selectedRole = roleDraftByUserId[item.id] ?? item.role;
              const selectedManagerId = managerDraftByUserId[item.id] ?? (item.managerId ?? "");
              const normalizedSelectedManagerId =
                selectedRole === "ADMIN" ? "" : selectedManagerId.trim();
              const currentManagerId = (item.managerId ?? "").trim();
              const accessChanged =
                selectedRole !== item.role || normalizedSelectedManagerId !== currentManagerId;
              const managerOptions = managers.filter((manager) => manager.id !== item.id);
              const managerName =
                selectedRole === "ADMIN"
                  ? "N/A (Admin)"
                  : normalizedSelectedManagerId
                    ? managersById.get(normalizedSelectedManagerId)?.name ?? "Unassigned"
                    : "Unassigned";

              return (
                <div key={item.id} className="table-row users-table">
                  <div className="users-identity">
                    <div className="users-avatar">{initials}</div>
                    <div className="users-identity-meta">
                      <div className="users-name">{item.name}</div>
                      <div className="users-email">{item.email}</div>
                    </div>
                  </div>
                  <div className="users-role-col">
                    <span className={`role-pill role-${selectedRole.toLowerCase()}`}>{selectedRole}</span>
                    {canEditAccess && (
                      <select
                        className="inline-select"
                        value={selectedRole}
                        onChange={(event) => handleRoleDraftChange(item.id, event.target.value as Role)}
                        disabled={updateAccessMutation.isPending && updatingAccessId === item.id}
                      >
                        <option value="EMPLOYEE">EMPLOYEE</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    )}
                  </div>
                  <div className="users-manager-col">
                    <span className="users-manager-name">{managerName}</span>
                    {canEditAccess && selectedRole !== "ADMIN" && (
                      <div className="manager-assignment">
                        <select
                          value={selectedManagerId}
                          onChange={(event) => handleManagerDraftChange(item.id, event.target.value)}
                          disabled={updateAccessMutation.isPending && updatingAccessId === item.id}
                        >
                          <option value="">No manager</option>
                          {managerOptions.map((manager) => (
                            <option key={manager.id} value={manager.id}>
                              {manager.name} ({manager.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="users-projects">{projectSummary(item.projects)}</div>
                  <div>
                    <span className={`status-pill ${item.isActive ? "status-approved" : "status-rejected"}`}>
                      {item.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div>
                    {canEditAccess || canAdminToggleActive || canManagerDeactivate || canManageKpi ? (
                      <div className="table-actions">
                        {canEditAccess && (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => handleAccessSave(item)}
                            disabled={!accessChanged || (updateAccessMutation.isPending && updatingAccessId === item.id)}
                          >
                            {updateAccessMutation.isPending && updatingAccessId === item.id
                              ? "Saving..."
                              : "Save access"}
                          </button>
                        )}
                        {canAdminToggleActive && (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => handleToggleActive(item, !item.isActive)}
                            disabled={toggleActiveMutation.isPending && togglingActiveId === item.id}
                          >
                            {toggleActiveMutation.isPending && togglingActiveId === item.id
                              ? item.isActive
                                ? "Deactivating..."
                                : "Activating..."
                              : item.isActive
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        )}
                        {canManageKpi && (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => handleManageKpi(item)}
                          >
                            Manage KPI
                          </button>
                        )}
                        {canManagerDeactivate && (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => handleDelete(item)}
                            disabled={deleteMutation.isPending && deletingId === item.id}
                          >
                            {deleteMutation.isPending && deletingId === item.id ? "Deactivating..." : "Deactivate"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="panel-sub">No actions</span>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && (
              <div className="empty-state">No users match the current filters.</div>
            )}
          </div>
        </div>

        {filteredUsers.length > 0 && (
          <div className="users-pagination">
            <span className="panel-sub">
              Showing {visibleUsers.length} of {filteredUsers.length} users
            </span>
            <div className="users-pagination-controls">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setUsersPage((page) => Math.max(1, page - 1))}
                disabled={usersPage <= 1}
              >
                Previous
              </button>
              <span className="panel-sub">
                Page {usersPage} of {totalUsersPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setUsersPage((page) => Math.min(totalUsersPages, page + 1))}
                disabled={usersPage >= totalUsersPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {managingKpiUser && (
        <div className="panel">
          <div className="panel-header">
            <h3>KPI Entries: {managingKpiUser.name}</h3>
            <div className="table-actions">
              <span className="panel-sub">
                {userKpiEntries.length} {userKpiEntries.length === 1 ? "entry" : "entries"}
              </span>
              <button className="btn btn-ghost" type="button" onClick={() => setManagingKpiUser(null)}>
                Close
              </button>
            </div>
          </div>

          {isUserKpiEntriesLoading && <div className="panel-sub">Loading KPI entries...</div>}
          {userKpiEntriesError && <div className="panel-sub">Unable to load KPI entries.</div>}

          {!isUserKpiEntriesLoading && !userKpiEntriesError && userKpiEntries.length === 0 && (
            <div className="empty-state">No KPI entries found for this user.</div>
          )}

          {!isUserKpiEntriesLoading && !userKpiEntriesError && userKpiEntries.length > 0 && (
            <div className="table">
              <div className="table-row table-header submissions-table">
                <div>Template</div>
                <div>Period</div>
                <div>Submitted On</div>
                <div>Score</div>
                <div>Status</div>
                <div>Action</div>
              </div>
              {userKpiEntries.map((entry) => (
                <div key={entry.id} className="table-row submissions-table">
                  <div>{entry.template.name}</div>
                  <div>
                    {formatDate(entry.periodStart)} - {formatDate(entry.periodEnd)}
                  </div>
                  <div>{formatDate(entry.submittedAt)}</div>
                  <div>{entry.score?.toFixed(2) ?? "--"}</div>
                  <div>
                    <span className={`status-pill status-${entry.status.toLowerCase()}`}>
                      {entry.status.replace("_", " ")}
                    </span>
                  </div>
                  <div>
                    <div className="table-actions">
                      <Link className="btn btn-ghost" to={`/submissions/${entry.id}`}>
                        View
                      </Link>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => handleDeleteKpiEntry(entry)}
                        disabled={deleteKpiEntryMutation.isPending && deletingKpiEntryId === entry.id}
                      >
                        {deleteKpiEntryMutation.isPending && deletingKpiEntryId === entry.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
