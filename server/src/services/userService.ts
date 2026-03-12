import { Role } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

type UpdateUserInput = {
  name?: string | null;
  role?: Role;
  managerId?: string | null;
  isActive?: boolean;
};

type UpdateProfileInput = {
  name?: string;
  email?: string;
  skills?: string | null;
};

function shapeUserProjectsWithCounts(
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    totalTickets: number;
    doneTickets: number;
    overdueTickets: number;
    changeRequestTickets: number;
  }>
) {
  return projects.map((project) => {
    const {
      totalTickets,
      doneTickets,
      overdueTickets,
      changeRequestTickets,
      ...baseProject
    } = project;

    return {
      ...baseProject,
      ticketCounts: {
        total: totalTickets,
        done: doneTickets,
        overdue: overdueTickets,
        changeRequests: changeRequestTickets,
      },
    };
  });
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      managerId: true,
      isActive: true,
      skills: true,
      createdAt: true,
      projects: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          totalTickets: true,
          doneTickets: true,
          overdueTickets: true,
          changeRequestTickets: true,
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  return users.map((user) => ({
    ...user,
    projects: shapeUserProjectsWithCounts(user.projects),
  }));
}

export async function listTeamUsers(managerId: string) {
  const users = await prisma.user.findMany({
    where: { managerId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      managerId: true,
      isActive: true,
      skills: true,
      projects: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          totalTickets: true,
          doneTickets: true,
          overdueTickets: true,
          changeRequestTickets: true,
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  return users.map((user) => ({
    ...user,
    projects: shapeUserProjectsWithCounts(user.projects),
  }));
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!target) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const nextRole = input.role ?? target.role;
  const managerProvided = input.managerId !== undefined;

  if (nextRole === Role.ADMIN && managerProvided && input.managerId !== null) {
    throw new AppError("Admin cannot have a manager", 400, "ADMIN_MANAGER_NOT_ALLOWED");
  }

  if (managerProvided && input.managerId === id) {
    throw new AppError("User cannot be their own manager", 400, "MANAGER_SELF");
  }

  if (managerProvided && input.managerId) {
    const manager = await prisma.user.findUnique({
      where: { id: input.managerId },
      select: { id: true, role: true },
    });
    if (!manager) {
      throw new AppError("Manager not found", 404, "MANAGER_NOT_FOUND");
    }
    const allowedRoles: Role[] = [Role.MANAGER, Role.ADMIN];
    if (!allowedRoles.includes(manager.role)) {
      throw new AppError("Assigned manager must be a manager or admin", 400, "MANAGER_INVALID");
    }
  }

  const nextManagerId =
    nextRole === Role.ADMIN ? null : managerProvided ? input.managerId : undefined;

  return prisma.user.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      role: input.role ?? undefined,
      managerId: nextManagerId,
      isActive: input.isActive === undefined ? undefined : input.isActive,
    },
    select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true, skills: true },
  });
}

export async function updateMyProfile(userId: string, input: UpdateProfileInput) {
  const normalizedEmail = input.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail, id: { not: userId } },
      select: { id: true },
    });
    if (existingUser) {
      throw new AppError("Email already in use", 409, "EMAIL_IN_USE");
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name ?? undefined,
      email: normalizedEmail ?? undefined,
      skills: input.skills === undefined ? undefined : input.skills,
    },
    select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true, skills: true },
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new AppError("Current password is incorrect", 400, "PASSWORD_INVALID");
  }

  const isSame = await verifyPassword(newPassword, user.passwordHash);
  if (isSame) {
    throw new AppError("New password must be different", 400, "PASSWORD_UNCHANGED");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

type RequestingUser = {
  id: string;
  role: Role;
};

async function assertKpiManagementAccess(requester: RequestingUser, targetId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, managerId: true },
  });

  if (!target) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  if (requester.role === Role.MANAGER) {
    if (target.managerId !== requester.id) {
      throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
  } else if (requester.role !== Role.ADMIN) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  return target;
}

export async function deactivateUser(requester: RequestingUser, targetId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, managerId: true, isActive: true },
  });

  if (!target) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  if (requester.role === Role.MANAGER) {
    if (target.role !== Role.EMPLOYEE || target.managerId !== requester.id) {
      throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
  } else if (requester.role !== Role.ADMIN) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  if (requester.id === target.id) {
    throw new AppError("You cannot delete your own account", 400, "SELF_DELETE_FORBIDDEN");
  }

  return prisma.user.update({
    where: { id: targetId },
    data: { isActive: false },
    select: { id: true, name: true, email: true, role: true, managerId: true, isActive: true, skills: true },
  });
}

export async function listUserKpiEntries(requester: RequestingUser, targetId: string) {
  await assertKpiManagementAccess(requester, targetId);

  return prisma.kpiSubmission.findMany({
    where: { userId: targetId },
    orderBy: { periodEnd: "desc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      score: true,
      submittedAt: true,
      template: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

export async function deleteUserKpiEntry(requester: RequestingUser, targetId: string, submissionId: string) {
  await assertKpiManagementAccess(requester, targetId);

  const submission = await prisma.kpiSubmission.findFirst({
    where: { id: submissionId, userId: targetId },
    select: { id: true },
  });

  if (!submission) {
    throw new AppError("KPI submission not found", 404, "SUBMISSION_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiValue.deleteMany({ where: { submissionId } });
    await tx.kpiGoalNote.deleteMany({ where: { submissionId } });
    await tx.kpiComment.deleteMany({ where: { submissionId } });
    await tx.kpiReview.deleteMany({ where: { submissionId } });
    await tx.kpiSubmission.delete({ where: { id: submissionId } });
  });

  return { deletedSubmissionId: submission.id };
}
