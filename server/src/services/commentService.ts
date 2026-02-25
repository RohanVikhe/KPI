import { Role } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { assertSubmissionAccess } from "../utils/access.js";

type CommentInput = {
  submissionId: string;
  authorId: string;
  authorRole: Role;
  message: string;
};

export async function addComment(input: CommentInput) {
  const submission = await prisma.kpiSubmission.findUnique({
    where: { id: input.submissionId },
    include: { user: { select: { id: true, managerId: true } } },
  });

  if (!submission) {
    throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
  }

  assertSubmissionAccess({
    requesterId: input.authorId,
    requesterRole: input.authorRole,
    submissionUserId: submission.userId,
    submissionManagerId: submission.user.managerId,
  });

  return prisma.kpiComment.create({
    data: {
      submissionId: input.submissionId,
      authorId: input.authorId,
      message: input.message,
    },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
}
