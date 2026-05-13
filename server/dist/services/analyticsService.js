import { Role, SubmissionStatus } from "@prisma/client";
import { Parser } from "expr-eval";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";
import { parseFlexibleDateString } from "../utils/date.js";
import { normalizeMetricLabel } from "../utils/labels.js";
import { computeMetricValues, computeOverallScore } from "../utils/score.js";
function normalizeScore(score) {
    return typeof score === "number" && Number.isFinite(score) ? score : 0;
}
const ANALYTICS_VISIBLE_STATUSES = [SubmissionStatus.APPROVED];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RAW_DELIVERY_DATA_START = "[[RAW_DELIVERY_DATA_START]]";
const RAW_DELIVERY_DATA_END = "[[RAW_DELIVERY_DATA_END]]";
const RAW_MAX_HEADERS = 30;
const RAW_MAX_ROWS = 120;
const RAW_MAX_CELL_LENGTH = 500;
const RAW_MAX_LINK_LENGTH = 1000;
function toUtcDateOnly(value) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function utcMonthStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function utcMonthEnd(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}
function utcMonthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addUtcDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
function daySpanInclusive(start, end) {
    return Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1;
}
function maxDate(a, b) {
    return a > b ? a : b;
}
function minDate(a, b) {
    return a < b ? a : b;
}
function buildSubmissionDateRangeWhere(range) {
    if (!range?.from && !range?.to) {
        return {};
    }
    const andFilters = [];
    if (range.from) {
        andFilters.push({ periodEnd: { gte: range.from } });
    }
    if (range.to) {
        andFilters.push({ periodStart: { lte: range.to } });
    }
    return andFilters.length > 0 ? { AND: andFilters } : {};
}
function buildSubmittedAtDateRangeWhere(range) {
    if (!range?.from && !range?.to) {
        return {};
    }
    return {
        submittedAt: {
            ...(range?.from ? { gte: range.from } : {}),
            ...(range?.to ? { lte: range.to } : {}),
        },
    };
}
function normalizeRawDeliveryData(input) {
    if (!input || !Array.isArray(input.headers) || !Array.isArray(input.rows)) {
        return null;
    }
    const headers = input.headers
        .map((header) => String(header ?? "").trim())
        .filter((header) => header.length > 0)
        .slice(0, RAW_MAX_HEADERS);
    if (headers.length === 0) {
        return null;
    }
    const linksInput = Array.isArray(input.links) ? input.links : [];
    const rows = [];
    const links = [];
    let hasAnyLinks = false;
    input.rows.slice(0, RAW_MAX_ROWS).forEach((row, rowIndex) => {
        const sourceRow = Array.isArray(row) ? row : [];
        const sourceLinks = Array.isArray(linksInput[rowIndex]) ? linksInput[rowIndex] : [];
        const normalizedRow = headers.map((_header, index) => String(sourceRow[index] ?? "")
            .trim()
            .slice(0, RAW_MAX_CELL_LENGTH));
        const normalizedLinks = headers.map((_header, index) => {
            const rawLink = String(sourceLinks[index] ?? "")
                .trim()
                .slice(0, RAW_MAX_LINK_LENGTH);
            if (!rawLink || rawLink.startsWith("#")) {
                return null;
            }
            return rawLink;
        });
        const hasRowData = normalizedRow.some((cell, index) => (index === 0 ? false : cell.length > 0 || Boolean(normalizedLinks[index])));
        if (!hasRowData) {
            return;
        }
        if (normalizedLinks.some((link) => Boolean(link))) {
            hasAnyLinks = true;
        }
        rows.push(normalizedRow);
        links.push(normalizedLinks);
    });
    if (rows.length === 0) {
        return null;
    }
    const sheetName = input.sheetName ? String(input.sheetName).trim().slice(0, 80) : undefined;
    return hasAnyLinks ? { sheetName, headers, rows, links } : { sheetName, headers, rows };
}
function extractRawDeliveryDataFromGoalNotes(goalNotes) {
    if (!goalNotes || goalNotes.length === 0) {
        return null;
    }
    for (const goalNote of goalNotes) {
        const note = goalNote.note;
        if (!note)
            continue;
        const startIndex = note.indexOf(RAW_DELIVERY_DATA_START);
        const endIndex = note.indexOf(RAW_DELIVERY_DATA_END);
        if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
            continue;
        }
        const jsonStart = startIndex + RAW_DELIVERY_DATA_START.length;
        const rawJson = note.slice(jsonStart, endIndex).trim();
        try {
            return normalizeRawDeliveryData(JSON.parse(rawJson));
        }
        catch {
            return null;
        }
    }
    return null;
}
function parseBoolish(value) {
    if (!value)
        return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return null;
    if (["1", "y", "yes", "true"].includes(normalized))
        return true;
    if (["0", "n", "no", "false"].includes(normalized))
        return false;
    return null;
}
function parseNumber(value) {
    if (!value)
        return 0;
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseDateValue(value) {
    const parsed = parseFlexibleDateString(value);
    return parsed.kind === "valid" ? parsed.date : null;
}
function normalizeHeaderValue(value) {
    return value.trim().toLowerCase();
}
function findColumnByFragments(headers, fragments) {
    return headers.findIndex((header) => fragments.every((fragment) => header.includes(fragment)));
}
function getRawIssueColumns(headers) {
    const normalizedHeaders = headers.map(normalizeHeaderValue);
    const findByOptions = (options) => options.map((fragments) => findColumnByFragments(normalizedHeaders, fragments)).find((index) => index !== -1) ?? -1;
    return {
        ticketId: findByOptions([["ticket", "id"], ["ticket", "#"]]),
        deliveryDate: findByOptions([["delivery", "date"]]),
        dueDate: findByOptions([["due", "date"]]),
        workType: findByOptions([["type"]]),
        reworkFlag: findByOptions([["rework", "flag"], ["rework", "y/n"]]),
        reworkCount: findByOptions([["rework", "count"]]),
        escalationFlag: findByOptions([["esc", "flag"], ["escalat", "flag"], ["escalat", "y/n"]]),
        escalationLevel: findByOptions([["escalation", "level"]]),
        postDefectFlag: findByOptions([["pdd", "flag"], ["defect", "flag"]]),
        postDefectCount: findByOptions([["defect", "count"]]),
        ftrFlag: findByOptions([["ftr", "flag"], ["first", "time", "right"]]),
    };
}
function getIssueTypeForMetricKey(metricKey) {
    const normalized = metricKey.toLowerCase();
    if (normalized.includes("additional_initiatives"))
        return "additionalInitiative";
    if (normalized.includes("automation_adoption") || normalized.includes("qp_automated_projects")) {
        return "aiAdoption";
    }
    if (normalized.includes("escalation"))
        return "escalation";
    if (normalized.includes("post_delivery") || normalized.includes("post-delivery") || normalized.includes("defect")) {
        return "postDefect";
    }
    if (normalized.includes("rework"))
        return "rework";
    if (normalized.includes("first_time_right") || normalized.includes("deliverables_accepted") || normalized.includes("ftr")) {
        return "notFtr";
    }
    if (normalized.includes("on_time_delivery") || normalized.includes("projects_on_time_budget")) {
        return "late";
    }
    return null;
}
function collectIssueTicketsByMetricKey(metricKeys, submissions) {
    if (metricKeys.length === 0 || submissions.length === 0) {
        return {};
    }
    const keysByIssueType = new Map();
    metricKeys.forEach((metricKey) => {
        const issueType = getIssueTypeForMetricKey(metricKey);
        if (!issueType)
            return;
        const list = keysByIssueType.get(issueType) ?? [];
        list.push(metricKey);
        keysByIssueType.set(issueType, list);
    });
    if (keysByIssueType.size === 0) {
        return {};
    }
    const map = new Map();
    const addTicket = (metricKey, ticket) => {
        const current = map.get(metricKey) ?? [];
        if (current.some((existing) => existing.id === ticket.id))
            return;
        current.push(ticket);
        map.set(metricKey, current);
    };
    const addTicketForIssue = (issueType, ticket) => {
        const keys = keysByIssueType.get(issueType);
        if (!keys)
            return;
        keys.forEach((metricKey) => addTicket(metricKey, ticket));
    };
    submissions.forEach((submission) => {
        const rawDeliveryData = submission.rawDeliveryData;
        if (!rawDeliveryData || rawDeliveryData.rows.length === 0)
            return;
        const columns = getRawIssueColumns(rawDeliveryData.headers);
        if (columns.ticketId === -1)
            return;
        rawDeliveryData.rows.forEach((row, rowIndex) => {
            const ticketId = row[columns.ticketId]?.trim();
            if (!ticketId)
                return;
            const ticketLink = rawDeliveryData.links?.[rowIndex]?.[columns.ticketId] ?? null;
            const escalationFlag = columns.escalationFlag !== -1 ? parseBoolish(row[columns.escalationFlag]) : null;
            const escalationLevel = columns.escalationLevel !== -1 ? row[columns.escalationLevel]?.trim().toLowerCase() : "";
            const escalated = escalationFlag !== null ? escalationFlag : escalationLevel.length > 0 && escalationLevel !== "none";
            const postDefectFlag = columns.postDefectFlag !== -1 ? parseBoolish(row[columns.postDefectFlag]) : null;
            const postDefectCount = columns.postDefectCount !== -1 ? parseNumber(row[columns.postDefectCount]) : 0;
            const postDefect = postDefectFlag !== null ? postDefectFlag : postDefectCount > 0;
            const reworkFlag = columns.reworkFlag !== -1 ? parseBoolish(row[columns.reworkFlag]) : null;
            const reworkCount = columns.reworkCount !== -1 ? parseNumber(row[columns.reworkCount]) : 0;
            const rework = reworkFlag !== null ? reworkFlag : reworkCount > 0;
            const ftrFlag = columns.ftrFlag !== -1 ? parseBoolish(row[columns.ftrFlag]) : null;
            const notFtr = ftrFlag !== null ? !ftrFlag : rework;
            const deliveryDate = columns.deliveryDate !== -1 ? parseDateValue(row[columns.deliveryDate]) : null;
            const dueDate = columns.dueDate !== -1 ? parseDateValue(row[columns.dueDate]) : null;
            const late = Boolean(deliveryDate && dueDate && deliveryDate.getTime() > dueDate.getTime());
            const workType = columns.workType !== -1 ? row[columns.workType]?.trim().toLowerCase() : "";
            const additionalInitiative = workType === "value add";
            const aiAdoption = workType === "ai adoption" || workType === "automation";
            const ticket = { id: ticketId, link: ticketLink };
            if (aiAdoption)
                addTicketForIssue("aiAdoption", ticket);
            if (additionalInitiative)
                addTicketForIssue("additionalInitiative", ticket);
            if (escalated)
                addTicketForIssue("escalation", ticket);
            if (postDefect)
                addTicketForIssue("postDefect", ticket);
            if (rework)
                addTicketForIssue("rework", ticket);
            if (notFtr)
                addTicketForIssue("notFtr", ticket);
            if (late)
                addTicketForIssue("late", ticket);
        });
    });
    return Object.fromEntries(map);
}
function applyUniqueRawIssueCountsToAggregates(metricKeys, submissions, aggregates) {
    if (metricKeys.length === 0) {
        return;
    }
    const hasRawDeliveryData = submissions.some((submission) => submission.rawDeliveryData?.rows.length);
    if (!hasRawDeliveryData) {
        return;
    }
    const issueTicketsByMetricKey = collectIssueTicketsByMetricKey(metricKeys, submissions);
    metricKeys.forEach((metricKey) => {
        aggregates.set(metricKey, {
            weightedTotal: issueTicketsByMetricKey[metricKey]?.length ?? 0,
            totalDays: 1,
        });
    });
}
const formulaParser = new Parser({
    operators: {
        logical: false,
        comparison: true,
        in: false,
        assignment: false,
    },
});
function evaluateFormulaSafe(formula, variables) {
    if (!formula || !formula.trim())
        return null;
    try {
        const expr = formulaParser.parse(formula);
        const requiredVars = expr.variables();
        for (const name of requiredVars) {
            if (!(name in variables)) {
                return null;
            }
        }
        const result = expr.evaluate(variables);
        if (typeof result !== "number") {
            return null;
        }
        if (!Number.isFinite(result)) {
            return 0;
        }
        return result;
    }
    catch {
        return null;
    }
}
function resolveAggregatedMetricValues(metrics, aggregates) {
    const variables = {};
    const resolved = new Map();
    metrics.forEach((metric) => {
        if (metric.isComputed)
            return;
        const aggregate = aggregates.get(metric.key);
        if (!aggregate || aggregate.totalDays <= 0)
            return;
        const rawValue = aggregate.weightedTotal / aggregate.totalDays;
        variables[metric.key] = rawValue;
        resolved.set(metric.key, rawValue);
    });
    metrics.forEach((metric) => {
        if (!metric.isComputed || !metric.calcFormula)
            return;
        const computedValue = evaluateFormulaSafe(metric.calcFormula, variables);
        if (computedValue === null)
            return;
        let finalValue = computedValue;
        if (metric.min !== null && metric.min !== undefined) {
            finalValue = Math.max(metric.min, finalValue);
        }
        if (metric.max !== null && metric.max !== undefined) {
            finalValue = Math.min(metric.max, finalValue);
        }
        variables[metric.key] = finalValue;
        resolved.set(metric.key, finalValue);
    });
    return resolved;
}
function buildMonthlyScorePoints(rows, range) {
    const buckets = new Map();
    const rangeStart = range?.from ? toUtcDateOnly(range.from) : null;
    const rangeEnd = range?.to ? toUtcDateOnly(range.to) : null;
    for (const row of rows) {
        let start = toUtcDateOnly(row.periodStart);
        let end = toUtcDateOnly(row.periodEnd);
        if (start > end) {
            continue;
        }
        if (rangeStart && end < rangeStart) {
            continue;
        }
        if (rangeEnd && start > rangeEnd) {
            continue;
        }
        if (rangeStart && start < rangeStart) {
            start = rangeStart;
        }
        if (rangeEnd && end > rangeEnd) {
            end = rangeEnd;
        }
        if (start > end) {
            continue;
        }
        let cursor = new Date(start.getTime());
        while (cursor <= end) {
            const monthStart = utcMonthStart(cursor);
            const monthEnd = utcMonthEnd(cursor);
            const segmentStart = maxDate(start, monthStart);
            const segmentEnd = minDate(end, monthEnd);
            const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
            if (daysCovered > 0) {
                const key = utcMonthKey(monthStart);
                const current = buckets.get(key) ?? { weightedTotal: 0, totalDays: 0 };
                current.weightedTotal += normalizeScore(row.score) * daysCovered;
                current.totalDays += daysCovered;
                buckets.set(key, current);
            }
            cursor = addUtcDays(monthEnd, 1);
        }
    }
    return Array.from(buckets.entries())
        .map(([monthKey, value]) => ({
        monthKey,
        score: value.totalDays > 0 ? value.weightedTotal / value.totalDays : 0,
        totalDays: value.totalDays,
    }))
        .sort((a, b) => (a.monthKey > b.monthKey ? 1 : -1));
}
async function resolveAnalyticsTargetUser(requesterId, requesterRole, targetUserId) {
    const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true, role: true, managerId: true },
    });
    if (!target) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    if (requesterRole === Role.ADMIN) {
        return target;
    }
    if (target.id !== requesterId && target.managerId !== requesterId) {
        throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
    return target;
}
export async function getUserAnalytics(userId, range) {
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId,
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: { periodStart: true, periodEnd: true, score: true },
    });
    const points = buildMonthlyScorePoints(submissions, range).map((item) => ({
        date: item.monthKey,
        score: item.score,
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
async function resolveTeamUserIds(requesterId, requesterRole) {
    if (requesterRole === Role.ADMIN) {
        const users = await prisma.user.findMany({
            where: { role: { in: [Role.EMPLOYEE, Role.MANAGER] } },
            select: { id: true },
        });
        return users.map((user) => user.id);
    }
    const reports = await prisma.user.findMany({
        where: { managerId: requesterId },
        select: { id: true },
    });
    return reports.map((report) => report.id);
}
export async function getTeamAnalytics(requesterId, requesterRole, range) {
    const userFilter = await resolveTeamUserIds(requesterId, requesterRole);
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
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            userId: true,
            periodStart: true,
            periodEnd: true,
            score: true,
            user: { select: { name: true } },
        },
    });
    const rowsByUser = new Map();
    for (const submission of submissions) {
        const userRows = rowsByUser.get(submission.userId) ?? {
            name: submission.user?.name ?? "Unknown",
            rows: [],
        };
        userRows.rows.push({
            periodStart: submission.periodStart,
            periodEnd: submission.periodEnd,
            score: submission.score,
        });
        rowsByUser.set(submission.userId, userRows);
    }
    const userMonthRows = [];
    for (const [userId, info] of rowsByUser.entries()) {
        const monthlyPoints = buildMonthlyScorePoints(info.rows, range);
        monthlyPoints.forEach((point) => {
            userMonthRows.push({
                userId,
                name: info.name,
                monthKey: point.monthKey,
                score: point.score,
                totalDays: point.totalDays,
            });
        });
    }
    const byUser = new Map();
    const byDate = new Map();
    let teamWeightedTotal = 0;
    let teamTotalDays = 0;
    for (const item of userMonthRows) {
        const userEntry = byUser.get(item.userId) ?? {
            name: item.name,
            weightedTotal: 0,
            totalDays: 0,
            count: 0,
        };
        if (item.totalDays > 0) {
            userEntry.weightedTotal += item.score * item.totalDays;
            userEntry.totalDays += item.totalDays;
            teamWeightedTotal += item.score * item.totalDays;
            teamTotalDays += item.totalDays;
        }
        userEntry.count += 1;
        byUser.set(item.userId, userEntry);
        const dateEntry = byDate.get(item.monthKey) ?? {
            weightedTotal: 0,
            totalDays: 0,
            count: 0,
        };
        if (item.totalDays > 0) {
            dateEntry.weightedTotal += item.score * item.totalDays;
            dateEntry.totalDays += item.totalDays;
        }
        dateEntry.count += 1;
        byDate.set(item.monthKey, dateEntry);
    }
    const ranking = Array.from(byUser.entries())
        .map(([userId, info]) => ({
        userId,
        name: info.name,
        averageScore: info.totalDays > 0 ? info.weightedTotal / info.totalDays : 0,
        submissions: info.count,
    }))
        .sort((a, b) => b.averageScore - a.averageScore);
    const trend = Array.from(byDate.entries())
        .map(([date, entry]) => ({
        date,
        averageScore: entry.totalDays > 0 ? entry.weightedTotal / entry.totalDays : 0,
    }))
        .sort((a, b) => (a.date > b.date ? 1 : -1));
    const overallAverage = teamTotalDays > 0 ? teamWeightedTotal / teamTotalDays : 0;
    return {
        ranking,
        trend,
        summary: {
            totalEmployees: ranking.length,
            averageScore: overallAverage,
        },
    };
}
export async function getTeamMemberAnalytics(requesterId, requesterRole, targetUserId, range) {
    const user = await resolveAnalyticsTargetUser(requesterId, requesterRole, targetUserId);
    const analytics = await getUserAnalytics(user.id, range);
    const goalProgress = await getUserGoalProgress(user.id, range);
    const goalMetricProgress = await getGoalMetricProgressForUsers([user.id], range);
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId: user.id,
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            goalNotes: { select: { note: true } },
        },
    });
    const metricKeys = goalMetricProgress.flatMap((goal) => goal.metrics.map((metric) => metric.key));
    const issueTicketsByMetricKey = collectIssueTicketsByMetricKey(metricKeys, submissions.map((submission) => ({
        rawDeliveryData: extractRawDeliveryDataFromGoalNotes(submission.goalNotes),
    })));
    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        goalProgress,
        goalMetricProgress,
        issueTicketsByMetricKey,
        ...analytics,
    };
}
export async function getTeamCombinedMemberAnalytics(requesterId, requesterRole, range) {
    const userFilter = await resolveTeamUserIds(requesterId, requesterRole);
    const goalMetricProgress = await getGoalMetricProgressForUsers(userFilter, range, {
        dedupeAdditionalInitiatives: true,
    });
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId: { in: userFilter },
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            goalNotes: { select: { note: true } },
        },
    });
    const metricKeys = goalMetricProgress.flatMap((goal) => goal.metrics.map((metric) => metric.key));
    const issueTicketsByMetricKey = collectIssueTicketsByMetricKey(metricKeys, submissions.map((submission) => ({
        rawDeliveryData: extractRawDeliveryDataFromGoalNotes(submission.goalNotes),
    })));
    return {
        user: {
            id: "all",
            name: requesterRole === Role.ADMIN ? "All organization members" : "All team members",
            email: "",
            role: requesterRole,
        },
        goalProgress: [],
        goalMetricProgress,
        issueTicketsByMetricKey,
        points: [],
        rollingAverage: [],
        summary: {
            total: submissions.length,
            lastScore: 0,
            delta: 0,
        },
    };
}
export async function getTeamMetricTrend(requesterId, requesterRole, metricId, range) {
    const metric = await prisma.kpiMetric.findUnique({
        where: { id: metricId },
        select: {
            id: true,
            label: true,
            type: true,
            targetText: true,
            goal: {
                select: {
                    id: true,
                    name: true,
                    metrics: { orderBy: { order: "asc" } },
                },
            },
        },
    });
    if (!metric || !metric.goal) {
        throw new AppError("Metric not found", 404, "METRIC_NOT_FOUND");
    }
    const userFilter = await resolveTeamUserIds(requesterId, requesterRole);
    if (userFilter.length === 0) {
        return {
            metric: {
                metricId: metric.id,
                label: normalizeMetricLabel(metric.label),
                type: metric.type,
                goalId: metric.goal.id,
                goalName: metric.goal.name,
                targetText: metric.targetText ?? null,
            },
            trend: [],
        };
    }
    const goalMetricIds = metric.goal.metrics.map((goalMetric) => goalMetric.id);
    const rawMetrics = metric.goal.metrics.filter((goalMetric) => !goalMetric.isComputed);
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId: { in: userFilter },
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            periodStart: true,
            periodEnd: true,
            submittedAt: true,
            values: {
                where: { metricId: { in: goalMetricIds } },
                select: { metricId: true, valueNumber: true },
            },
        },
    });
    const monthAggregates = new Map();
    const rangeStart = range?.from ? toUtcDateOnly(range.from) : null;
    const rangeEnd = range?.to ? toUtcDateOnly(range.to) : null;
    for (const submission of submissions) {
        let start = toUtcDateOnly(submission.periodStart);
        let end = toUtcDateOnly(submission.periodEnd);
        const submittedAt = toUtcDateOnly(submission.submittedAt);
        if (submittedAt < end) {
            end = submittedAt;
        }
        if (start > end) {
            continue;
        }
        if (rangeStart && end < rangeStart) {
            continue;
        }
        if (rangeEnd && start > rangeEnd) {
            continue;
        }
        if (rangeStart && start < rangeStart) {
            start = rangeStart;
        }
        if (rangeEnd && end > rangeEnd) {
            end = rangeEnd;
        }
        if (start > end) {
            continue;
        }
        const valueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
        const monthSegments = [];
        let cursor = new Date(start.getTime());
        while (cursor <= end) {
            const monthStart = utcMonthStart(cursor);
            const monthEnd = utcMonthEnd(cursor);
            const segmentStart = maxDate(start, monthStart);
            const segmentEnd = minDate(end, monthEnd);
            const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
            if (daysCovered > 0) {
                monthSegments.push({
                    monthKey: utcMonthKey(monthStart),
                    daysCovered,
                });
            }
            cursor = addUtcDays(monthEnd, 1);
        }
        if (monthSegments.length === 0) {
            continue;
        }
        for (const metricItem of rawMetrics) {
            const rawValue = valueMap.get(metricItem.id);
            if (rawValue === null || rawValue === undefined) {
                continue;
            }
            monthSegments.forEach((segment) => {
                const monthEntry = monthAggregates.get(segment.monthKey) ?? new Map();
                const aggregate = monthEntry.get(metricItem.key) ?? { weightedTotal: 0, totalDays: 0 };
                aggregate.weightedTotal += rawValue * segment.daysCovered;
                aggregate.totalDays += segment.daysCovered;
                monthEntry.set(metricItem.key, aggregate);
                if (!monthAggregates.has(segment.monthKey)) {
                    monthAggregates.set(segment.monthKey, monthEntry);
                }
            });
        }
    }
    const trend = Array.from(monthAggregates.entries())
        .sort(([a], [b]) => (a > b ? 1 : -1))
        .map(([dateKey, aggregates]) => {
        const aggregatedValues = rawMetrics
            .map((metricItem) => {
            const aggregate = aggregates.get(metricItem.key);
            if (!aggregate || aggregate.totalDays <= 0)
                return null;
            return {
                metricId: metricItem.id,
                valueNumber: aggregate.weightedTotal / aggregate.totalDays,
            };
        })
            .filter(Boolean);
        if (aggregatedValues.length === 0) {
            return null;
        }
        const resolved = computeMetricValues(metric.goal.metrics, aggregatedValues);
        const value = resolved.get(metric.id);
        if (value === undefined) {
            return null;
        }
        return { date: dateKey, value };
    })
        .filter((item) => Boolean(item));
    return {
        metric: {
            metricId: metric.id,
            label: normalizeMetricLabel(metric.label),
            type: metric.type,
            goalId: metric.goal.id,
            goalName: metric.goal.name,
            targetText: metric.targetText ?? null,
        },
        trend,
    };
}
async function getUserGoalProgress(userId, range) {
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId,
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            periodStart: true,
            periodEnd: true,
            template: {
                select: {
                    formula: true,
                    goals: {
                        orderBy: { order: "asc" },
                        select: {
                            id: true,
                            key: true,
                            name: true,
                            formula: true,
                            weight: true,
                            metrics: {
                                orderBy: { order: "asc" },
                            },
                        },
                    },
                },
            },
            values: {
                select: {
                    metricId: true,
                    valueNumber: true,
                },
            },
        },
    });
    const byGoalMonth = new Map();
    const goalOrder = new Map();
    const rangeStart = range?.from ? toUtcDateOnly(range.from) : null;
    const rangeEnd = range?.to ? toUtcDateOnly(range.to) : null;
    for (const submission of submissions) {
        const scoreResult = computeOverallScore({
            goals: submission.template.goals,
            values: submission.values,
            overallFormula: submission.template.formula,
            strict: false,
        });
        let start = toUtcDateOnly(submission.periodStart);
        let end = toUtcDateOnly(submission.periodEnd);
        if (start > end) {
            continue;
        }
        if (rangeStart && end < rangeStart) {
            continue;
        }
        if (rangeEnd && start > rangeEnd) {
            continue;
        }
        if (rangeStart && start < rangeStart) {
            start = rangeStart;
        }
        if (rangeEnd && end > rangeEnd) {
            end = rangeEnd;
        }
        if (start > end) {
            continue;
        }
        let cursor = new Date(start.getTime());
        while (cursor <= end) {
            const monthStart = utcMonthStart(cursor);
            const monthEnd = utcMonthEnd(cursor);
            const segmentStart = maxDate(start, monthStart);
            const segmentEnd = minDate(end, monthEnd);
            const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
            if (daysCovered > 0) {
                const monthKey = utcMonthKey(monthStart);
                scoreResult.goalScores.forEach((goal, index) => {
                    if (goal.score === null || goal.score === undefined) {
                        return;
                    }
                    const aggregateKey = goal.key || goal.goalId;
                    if (!goalOrder.has(aggregateKey)) {
                        goalOrder.set(aggregateKey, index);
                    }
                    const goalMonthKey = `${aggregateKey}::${monthKey}`;
                    const existing = byGoalMonth.get(goalMonthKey);
                    if (!existing) {
                        byGoalMonth.set(goalMonthKey, {
                            goalId: goal.goalId,
                            key: goal.key,
                            name: goal.name,
                            monthKey,
                            weightedTotal: goal.score * daysCovered,
                            totalDays: daysCovered,
                        });
                        return;
                    }
                    existing.weightedTotal += goal.score * daysCovered;
                    existing.totalDays += daysCovered;
                });
            }
            cursor = addUtcDays(monthEnd, 1);
        }
    }
    const byGoal = new Map();
    Array.from(byGoalMonth.values()).forEach((goalMonth) => {
        if (goalMonth.totalDays <= 0) {
            return;
        }
        const score = goalMonth.weightedTotal / goalMonth.totalDays;
        const aggregateKey = goalMonth.key || goalMonth.goalId;
        const existing = byGoal.get(aggregateKey);
        if (!existing) {
            byGoal.set(aggregateKey, {
                goalId: goalMonth.goalId,
                key: goalMonth.key,
                name: goalMonth.name,
                total: score,
                count: 1,
                order: goalOrder.get(aggregateKey) ?? 0,
            });
            return;
        }
        existing.total += score;
        existing.count += 1;
    });
    return Array.from(byGoal.values())
        .map((item) => ({
        goalId: item.goalId,
        key: item.key,
        name: item.name,
        averageScore: item.count > 0 ? item.total / item.count : 0,
        submissions: item.count,
        order: item.order,
    }))
        .sort((a, b) => {
        if (a.order !== b.order)
            return a.order - b.order;
        return a.name.localeCompare(b.name);
    });
}
async function getGoalMetricProgressForUsers(userIds, range, options) {
    const submissions = await prisma.kpiSubmission.findMany({
        where: {
            userId: { in: userIds },
            status: { in: ANALYTICS_VISIBLE_STATUSES },
            ...buildSubmissionDateRangeWhere(range),
        },
        orderBy: { periodEnd: "asc" },
        select: {
            periodStart: true,
            periodEnd: true,
            template: {
                select: {
                    goals: {
                        orderBy: { order: "asc" },
                        select: {
                            id: true,
                            key: true,
                            name: true,
                            order: true,
                            metrics: {
                                orderBy: { order: "asc" },
                            },
                        },
                    },
                },
            },
            goalNotes: {
                select: {
                    note: true,
                },
            },
            values: {
                select: {
                    metricId: true,
                    valueNumber: true,
                },
            },
        },
    });
    const goalDefinitions = new Map();
    const monthAggregates = new Map();
    const rangeAggregates = new Map();
    const rangeStart = range?.from ? toUtcDateOnly(range.from) : null;
    const rangeEnd = range?.to ? toUtcDateOnly(range.to) : null;
    for (const submission of submissions) {
        let start = toUtcDateOnly(submission.periodStart);
        let end = toUtcDateOnly(submission.periodEnd);
        if (start > end) {
            continue;
        }
        if (rangeStart && end < rangeStart) {
            continue;
        }
        if (rangeEnd && start > rangeEnd) {
            continue;
        }
        if (rangeStart && start < rangeStart) {
            start = rangeStart;
        }
        if (rangeEnd && end > rangeEnd) {
            end = rangeEnd;
        }
        if (start > end) {
            continue;
        }
        const monthSegments = [];
        let cursor = new Date(start.getTime());
        while (cursor <= end) {
            const monthStart = utcMonthStart(cursor);
            const monthEnd = utcMonthEnd(cursor);
            const segmentStart = maxDate(start, monthStart);
            const segmentEnd = minDate(end, monthEnd);
            const daysCovered = daySpanInclusive(segmentStart, segmentEnd);
            if (daysCovered > 0) {
                monthSegments.push({
                    monthKey: utcMonthKey(monthStart),
                    daysCovered,
                });
            }
            cursor = addUtcDays(monthEnd, 1);
        }
        if (monthSegments.length === 0) {
            continue;
        }
        const totalDays = monthSegments.reduce((sum, segment) => sum + segment.daysCovered, 0);
        if (totalDays <= 0) {
            continue;
        }
        submission.template.goals.forEach((goal) => {
            const goalKey = goal.key || goal.id;
            const computedMetrics = goal.metrics.filter((metric) => metric.isComputed);
            const displayMetrics = computedMetrics.length > 0 ? computedMetrics : goal.metrics;
            if (!goalDefinitions.has(goalKey)) {
                goalDefinitions.set(goalKey, {
                    goalId: goal.id,
                    key: goal.key,
                    name: goal.name,
                    order: goal.order,
                    metrics: goal.metrics,
                    displayMetrics,
                });
            }
        });
        const valueMap = new Map(submission.values.map((value) => [value.metricId, value.valueNumber]));
        submission.template.goals.forEach((goal) => {
            goal.metrics.forEach((metric) => {
                if (metric.isComputed)
                    return;
                const rawValue = valueMap.get(metric.id);
                if (rawValue === null || rawValue === undefined)
                    return;
                monthSegments.forEach((segment) => {
                    const monthEntry = monthAggregates.get(segment.monthKey) ?? new Map();
                    const aggregate = monthEntry.get(metric.key) ?? { weightedTotal: 0, totalDays: 0 };
                    aggregate.weightedTotal += rawValue * segment.daysCovered;
                    aggregate.totalDays += segment.daysCovered;
                    monthEntry.set(metric.key, aggregate);
                    if (!monthAggregates.has(segment.monthKey)) {
                        monthAggregates.set(segment.monthKey, monthEntry);
                    }
                });
                const rangeAggregate = rangeAggregates.get(metric.key) ?? { weightedTotal: 0, totalDays: 1 };
                rangeAggregate.weightedTotal += rawValue;
                rangeAggregate.totalDays = 1;
                rangeAggregates.set(metric.key, rangeAggregate);
            });
        });
    }
    if (options?.dedupeAdditionalInitiatives) {
        const rawIssueCountMetricKeys = Array.from(new Set(Array.from(goalDefinitions.values()).flatMap((goal) => goal.metrics
            .filter((metric) => {
            if (metric.isComputed)
                return false;
            const issueType = getIssueTypeForMetricKey(metric.key);
            return issueType === "additionalInitiative" || issueType === "aiAdoption";
        })
            .map((metric) => metric.key))));
        applyUniqueRawIssueCountsToAggregates(rawIssueCountMetricKeys, submissions.map((submission) => ({
            rawDeliveryData: extractRawDeliveryDataFromGoalNotes(submission.goalNotes),
        })), rangeAggregates);
    }
    const monthKeys = Array.from(monthAggregates.keys()).sort((a, b) => (a > b ? 1 : -1));
    const byGoal = new Map();
    goalDefinitions.forEach((goal) => {
        const goalAggregateKey = goal.key || goal.goalId;
        const goalEntry = {
            goalId: goal.goalId,
            key: goal.key,
            name: goal.name,
            order: goal.order,
            metrics: new Map(),
        };
        const rangeResolved = resolveAggregatedMetricValues(goal.metrics, rangeAggregates);
        goal.displayMetrics.forEach((metric) => {
            goalEntry.metrics.set(metric.key, {
                metricId: metric.id,
                key: metric.key,
                label: normalizeMetricLabel(metric.label),
                type: metric.type,
                order: metric.order ?? 0,
                targetText: metric.targetText ?? null,
                overallValue: rangeResolved.get(metric.key) ?? 0,
                trend: new Map(),
            });
        });
        monthKeys.forEach((monthKey) => {
            const aggregates = monthAggregates.get(monthKey);
            if (!aggregates)
                return;
            const resolved = resolveAggregatedMetricValues(goal.metrics, aggregates);
            goal.displayMetrics.forEach((metric) => {
                const value = resolved.get(metric.key);
                if (value === undefined)
                    return;
                const metricEntry = goalEntry.metrics.get(metric.key);
                if (!metricEntry)
                    return;
                metricEntry.trend.set(monthKey, value);
            });
        });
        if (goalEntry.metrics.size > 0) {
            byGoal.set(goalAggregateKey, goalEntry);
        }
    });
    return Array.from(byGoal.values())
        .map((goal) => ({
        goalId: goal.goalId,
        key: goal.key,
        name: goal.name,
        order: goal.order,
        metrics: Array.from(goal.metrics.values())
            .map((metric) => ({
            metricId: metric.metricId,
            key: metric.key,
            label: normalizeMetricLabel(metric.label),
            type: metric.type,
            averageValue: Number.isFinite(metric.overallValue) ? metric.overallValue : 0,
            submissions: metric.trend.size,
            order: metric.order,
            targetText: metric.targetText ?? null,
            trend: Array.from(metric.trend.entries())
                .map(([date, value]) => ({ date, value }))
                .sort((a, b) => (a.date > b.date ? 1 : -1)),
        }))
            .sort((a, b) => {
            if (a.order !== b.order)
                return a.order - b.order;
            return a.label.localeCompare(b.label);
        }),
    }))
        .sort((a, b) => {
        if (a.order !== b.order)
            return a.order - b.order;
        return a.name.localeCompare(b.name);
    });
}
