import { Role, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
function normalizeScore(score) {
    return typeof score === "number" && Number.isFinite(score) ? score : 0;
}
export async function getUserAnalytics(userId) {
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId,
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED, SubmissionStatus.IN_REVIEW] },
        },
        orderBy: { periodEnd: "asc" },
        select: { periodEnd: true, score: true, status: true },
    });
    const points = submissions.map((item) => ({
        date: item.periodEnd.toISOString().slice(0, 10),
        score: normalizeScore(item.score),
    }));
    const rollingWindow = 3;
    const rollingAverage = points.map((point, index) => {
        const start = Math.max(0, index - rollingWindow + 1);
        const window = points.slice(start, index + 1);
        const avg = window.reduce((acc, cur) => acc + cur.score, 0) / window.length;
        return { date: point.date, value: avg };
    });
    const last = points[points.length - 1];
    const previous = points[points.length - 2];
    const delta = last && previous ? last.score - previous.score : 0;
    return {
        points,
        rollingAverage,
        summary: {
            total: points.length,
            lastScore: last?.score ?? 0,
            delta,
        },
    };
}
export async function getTeamAnalytics(requesterId, requesterRole) {
    let userFilter = [];
    if (requesterRole === Role.ADMIN) {
        const users = await prisma.user.findMany({
            where: { role: { in: [Role.EMPLOYEE, Role.MANAGER] } },
            select: { id: true },
        });
        userFilter = users.map((user) => user.id);
    }
    else {
        const reports = await prisma.user.findMany({
            where: { managerId: requesterId },
            select: { id: true },
        });
        userFilter = reports.map((report) => report.id);
    }
    if (userFilter.length === 0) {
        return {
            ranking: [],
            trend: [],
            summary: { totalEmployees: 0, averageScore: 0 },
        };
    }
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId: { in: userFilter },
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED, SubmissionStatus.IN_REVIEW] },
        },
        orderBy: { periodEnd: "asc" },
        select: {
            userId: true,
            periodEnd: true,
            score: true,
            user: { select: { name: true } },
        },
    });
    const byUser = new Map();
    const byDate = new Map();
    for (const submission of submissions) {
        const score = normalizeScore(submission.score);
        const userEntry = byUser.get(submission.userId) ?? {
            name: submission.user?.name ?? "Unknown",
            total: 0,
            count: 0,
        };
        userEntry.total += score;
        userEntry.count += 1;
        byUser.set(submission.userId, userEntry);
        const dateKey = submission.periodEnd.toISOString().slice(0, 10);
        const dateEntry = byDate.get(dateKey) ?? { total: 0, count: 0 };
        dateEntry.total += score;
        dateEntry.count += 1;
        byDate.set(dateKey, dateEntry);
    }
    const ranking = Array.from(byUser.entries())
        .map(([userId, info]) => ({
        userId,
        name: info.name,
        averageScore: info.count > 0 ? info.total / info.count : 0,
        submissions: info.count,
    }))
        .sort((a, b) => b.averageScore - a.averageScore);
    const trend = Array.from(byDate.entries())
        .map(([date, entry]) => ({
        date,
        averageScore: entry.count > 0 ? entry.total / entry.count : 0,
    }))
        .sort((a, b) => (a.date > b.date ? 1 : -1));
    const overallAverage = ranking.length > 0 ? ranking.reduce((acc, cur) => acc + cur.averageScore, 0) / ranking.length : 0;
    return {
        ranking,
        trend,
        summary: {
            totalEmployees: ranking.length,
            averageScore: overallAverage,
        },
    };
}
