import { AppError } from "../utils/errors.js";
import { createSubmission, getSubmissionDetails, listAllSubmissions, listMySubmissions, listTeamSubmissions, } from "../services/submissionService.js";
import { addComment } from "../services/commentService.js";
import { submitReview } from "../services/reviewService.js";
import { generateSubmissionReport, listReports } from "../services/reportService.js";
export async function createSubmissionHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const periodStart = new Date(req.body.periodStart);
    const periodEnd = new Date(req.body.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
        throw new AppError("Invalid period dates", 400, "PERIOD_INVALID");
    }
    const submission = await createSubmission(req.user.id, {
        ...req.body,
        periodStart,
        periodEnd,
    });
    return res.status(201).json({ submission });
}
export async function listMySubmissionsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const submissions = await listMySubmissions(req.user.id);
    return res.json({ submissions });
}
export async function listTeamSubmissionsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const submissions = await listTeamSubmissions(req.user.id);
    return res.json({ submissions });
}
export async function listAllSubmissionsHandler(_req, res) {
    const submissions = await listAllSubmissions();
    return res.json({ submissions });
}
export async function getSubmissionHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const submission = await getSubmissionDetails(id);
    if (!submission.user) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    if (req.user.role !== "ADMIN") {
        const isOwner = submission.userId === req.user.id;
        const isManager = req.user.role === "MANAGER" && submission.user.managerId === req.user.id;
        if (!isOwner && !isManager) {
            throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
        }
    }
    return res.json({ submission });
}
export async function addCommentHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const comment = await addComment({
        submissionId: id,
        authorId: req.user.id,
        authorRole: req.user.role,
        message: req.body.message,
    });
    return res.status(201).json({ comment });
}
export async function reviewSubmissionHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const result = await submitReview({
        submissionId: id,
        reviewerId: req.user.id,
        reviewerRole: req.user.role,
        status: req.body.status,
        comment: req.body.comment,
    });
    return res.status(201).json(result);
}
export async function generateReportHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const report = await generateSubmissionReport(id, req.user.id, req.user.role);
    return res.status(201).json({ report });
}
export async function listReportsHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const reports = await listReports(id, req.user.id, req.user.role);
    return res.json({ reports });
}
