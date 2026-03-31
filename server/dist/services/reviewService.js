import { ReviewStatus, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { assertSubmissionReviewAccess } from "../utils/access.js";
function mapSubmissionStatus(status) {
    if (status === ReviewStatus.APPROVED)
        return SubmissionStatus.APPROVED;
    if (status === ReviewStatus.REJECTED)
        return SubmissionStatus.REJECTED;
    return SubmissionStatus.IN_REVIEW;
}
export async function submitReview(input) {
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id: input.submissionId },
        include: { user: { select: { id: true, managerId: true } } },
    });
    if (!submission) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    if (submission.userId === input.reviewerId) {
        throw new AppError("You cannot review your own KPI submission", 403, "SELF_REVIEW_FORBIDDEN");
    }
    assertSubmissionReviewAccess({
        requesterId: input.reviewerId,
        requesterRole: input.reviewerRole,
        submissionUserId: submission.userId,
        submissionManagerId: submission.user.managerId,
    });
    const nextStatus = mapSubmissionStatus(input.status);
    return prisma.$transaction(async (tx) => {
        const review = await tx.kpiReview.create({
            data: {
                submissionId: submission.id,
                reviewerId: input.reviewerId,
                status: input.status,
                comment: input.comment ?? null,
            },
        });
        const updatedSubmission = await tx.kpiSubmission.update({
            where: { id: submission.id },
            data: {
                status: nextStatus,
                reviewerId: input.reviewerId,
                reviewedAt: new Date(),
            },
            include: {
                template: { include: { goals: { orderBy: { order: "asc" }, include: { metrics: { orderBy: { order: "asc" } } } } } },
                values: true,
                user: { select: { id: true, name: true, email: true, role: true, managerId: true } },
                reviews: { orderBy: { reviewedAt: "desc" } },
                comments: {
                    orderBy: { createdAt: "asc" },
                    include: { author: { select: { id: true, name: true, role: true } } },
                },
            },
        });
        return { review, submission: updatedSubmission };
    });
}
