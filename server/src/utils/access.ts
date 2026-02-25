import { Role } from "@prisma/client";
import { AppError } from "./errors.js";

type AccessContext = {
  requesterId: string;
  requesterRole: Role;
  submissionUserId: string;
  submissionManagerId?: string | null;
};

export function assertSubmissionAccess(context: AccessContext) {
  const { requesterId, requesterRole, submissionUserId, submissionManagerId } = context;

  if (requesterRole === Role.ADMIN) {
    return;
  }

  if (requesterId === submissionUserId) {
    return;
  }

  if (requesterRole === Role.MANAGER && submissionManagerId === requesterId) {
    return;
  }

  throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
}

export function assertSubmissionReviewAccess(context: AccessContext) {
  const { requesterId, requesterRole, submissionManagerId } = context;

  if (requesterRole === Role.ADMIN) {
    return;
  }

  if (requesterRole === Role.MANAGER && submissionManagerId === requesterId) {
    return;
  }

  throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
}
