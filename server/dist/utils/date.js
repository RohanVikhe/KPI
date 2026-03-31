const DATE_PREFIX_PATTERN = /^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})(?:[T\s].*)?$/;
const toUtcDateOnly = (year, month, day) => new Date(Date.UTC(year, month - 1, day));
const isValidDateParts = (year, month, day) => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return false;
    }
    if (month < 1 || month > 12 || day < 1) {
        return false;
    }
    const candidate = toUtcDateOnly(year, month, day);
    return (candidate.getUTCFullYear() === year &&
        candidate.getUTCMonth() === month - 1 &&
        candidate.getUTCDate() === day);
};
const expandYear = (year) => (year >= 70 ? 1900 + year : 2000 + year);
export const parseFlexibleDateString = (value) => {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
        return { kind: "empty", date: null };
    }
    const prefixedMatch = normalized.match(DATE_PREFIX_PATTERN);
    if (prefixedMatch) {
        const [, firstRaw, secondRaw, thirdRaw] = prefixedMatch;
        let year = 0;
        let month = 0;
        let day = 0;
        const first = Number(firstRaw);
        const second = Number(secondRaw);
        const third = Number(thirdRaw);
        if (firstRaw.length === 4) {
            year = first;
            month = second;
            day = third;
        }
        else if (thirdRaw.length === 4 || thirdRaw.length === 2) {
            year = thirdRaw.length === 2 ? expandYear(third) : third;
            if (first > 12 && second <= 12) {
                day = first;
                month = second;
            }
            else if (second > 12 && first <= 12) {
                month = first;
                day = second;
            }
            else if (first <= 12 && second <= 12) {
                return {
                    kind: "invalid",
                    code: "ambiguous",
                    message: `Ambiguous date "${normalized}". Use YYYY-MM-DD when both day and month are 12 or less.`,
                };
            }
            else {
                return {
                    kind: "invalid",
                    code: "invalid",
                    message: `Invalid date "${normalized}".`,
                };
            }
        }
        if (isValidDateParts(year, month, day)) {
            return { kind: "valid", date: toUtcDateOnly(year, month, day) };
        }
        return {
            kind: "invalid",
            code: "invalid",
            message: `Invalid date "${normalized}".`,
        };
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return {
            kind: "invalid",
            code: "invalid",
            message: `Invalid date "${normalized}".`,
        };
    }
    return { kind: "valid", date: parsed };
};
