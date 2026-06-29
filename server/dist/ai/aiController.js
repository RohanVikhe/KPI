import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { generateInsights } from "./aiService.js";
const RAW_DELIVERY_DATA_START = "[[RAW_DELIVERY_DATA_START]]";
const RAW_DELIVERY_DATA_END = "[[RAW_DELIVERY_DATA_END]]";
function extractRawDeliveryData(goalNotes) {
    for (const goalNote of goalNotes) {
        const note = goalNote.note;
        if (!note)
            continue;
        const startIndex = note.indexOf(RAW_DELIVERY_DATA_START);
        const endIndex = note.indexOf(RAW_DELIVERY_DATA_END);
        if (startIndex === -1 || endIndex === -1 || endIndex < startIndex)
            continue;
        const jsonStart = startIndex + RAW_DELIVERY_DATA_START.length;
        const rawJson = note.slice(jsonStart, endIndex).trim();
        try {
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
                return { headers: parsed.headers, rows: parsed.rows };
            }
        }
        catch {
            return null;
        }
    }
    return null;
}
export async function getInsights(req, res) {
    const { id } = req.params;
    // Fetch the submission with full metric details and goal notes (where raw data is stored)
    const submission = await prisma.kpiSubmission.findUnique({
        where: { id },
        select: {
            userId: true,
            user: { select: { name: true } },
            periodStart: true,
            periodEnd: true,
            values: {
                select: {
                    valueNumber: true,
                    metric: { select: { label: true, isComputed: true } },
                },
            },
            goalNotes: { select: { note: true } },
        },
    });
    if (!submission) {
        throw new AppError("Submission not found", 404, "SUBMISSION_NOT_FOUND");
    }
    // Only allow access to own submission or manager/admin
    const requestingUser = req.user;
    if (requestingUser.id !== submission.userId &&
        requestingUser.role !== "MANAGER" &&
        requestingUser.role !== "ADMIN") {
        throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
    // Build metric list (no scores — only raw input metrics)
    const metrics = submission.values
        .filter((v) => !v.metric.isComputed && v.valueNumber !== null)
        .map((v) => ({ label: v.metric.label, value: v.valueNumber }));
    // Extract raw delivery data from goal notes where it's stored as embedded JSON
    const rawDeliveryData = extractRawDeliveryData(submission.goalNotes);
    const dateRange = `${submission.periodStart.toISOString().slice(0, 10)} to ${submission.periodEnd.toISOString().slice(0, 10)}`;
    const insights = await generateInsights(metrics, rawDeliveryData, submission.user.name, { dateRange });
    res.json({ insights });
}
export async function getSnapshotInsights(req, res) {
    const { employeeName, metrics, dateRange, isTeamView } = req.body;
    if (!Array.isArray(metrics) || metrics.length === 0) {
        throw new AppError("No metrics provided", 400, "MISSING_METRICS");
    }
    // Only managers and admins can use the snapshot endpoint
    const requestingUser = req.user;
    if (requestingUser.role !== "MANAGER" && requestingUser.role !== "ADMIN") {
        throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
    const metricData = metrics.map((m) => ({
        label: String(m.label ?? ""),
        value: parseFloat(String(m.value).replace(/[^0-9.-]/g, "")) || 0,
    }));
    const name = String(employeeName ?? "Employee");
    const insights = await generateInsights(metricData, null, name, { dateRange, isTeamView });
    res.json({ insights });
}
