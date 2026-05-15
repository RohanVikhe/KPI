import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { ApiError, apiFetch } from "../lib/api.ts";
import { formatDateOnly, parseFlexibleDateString } from "../lib/date.ts";
import { evaluateFormula } from "../lib/formula.ts";
import type { Template } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";

const SUMMARY_SHEET_NAMES = ["summary", "submission"];
const INVALID_SHEET_CHARS = /[\/?*\[\]:]/g;
const RAW_DELIVERY_SHEET_NAMES = ["raw delivery log", "raw data", "delivery raw data", "data"];
const RAW_DELIVERY_DEFAULT_SHEET_NAME = "Raw Delivery Log";
const RAW_DELIVERY_MAX_ROWS = 1000;
const RAW_DELIVERY_TYPE_COLUMN_LETTER = "M";
const RAW_DELIVERY_TYPE_OPTIONS = [
  "Value Add",
  "AI Adoption",
  "Bug",
  "Story",
  "Training",
  "Knowledge Sharing",
  "Development",
  "Testing",
];
const RAW_AUTO_METRIC_KEYS = new Set<string>([
  "de_projects_on_time_budget",
  "de_total_projects_delivered",
  "de_total_deliverables",
  "de_deliverables_accepted",
  "de_escalation_count",
  "de_post_delivery_defects",
  "de_total_deliveries",
  "qp_automated_projects",
  "qp_rework_count",
  "qp_total_deliverables",
  "vc_additional_initiatives",
  "de_approved_scope_changes",
  "de_total_scope_requests",
  "qp_formal_changes",
  "qp_total_changes",
]);

const normalizeLabel = (value: unknown) => String(value ?? "").trim().toLowerCase();

const normalizeCell = (value: unknown, header?: string) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && (header === "periodStart" || header === "periodEnd")) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return date.toISOString().slice(0, 10);
    }
  }
  return String(value).trim();
};

const parseNumericValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid number");
  }
  return parsed;
};

const parseInputNumber = (value: string | undefined) => {
  if (value === undefined || value === null || value.trim() === "") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const getSubmissionErrorMessage = (error: unknown) => {
  if (error instanceof ApiError && error.code === "PERIOD_OVERLAP") {
    return "A KPI entry already exists for an overlapping period. Use non-overlapping dates or ask your manager/admin to remove the conflicting entry.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unable to save submission.";
};

const formatMetricValue = (value: number | null | undefined, type: string) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (type === "PERCENT") {
    return `${value.toFixed(2)}%`;
  }
  if (type === "CURRENCY") {
    return value.toFixed(2);
  }
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
};

const readSheetRows = (sheet: XLSX.WorkSheet) =>
  (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]).map((row) =>
    row.map((cell) => (cell === undefined ? "" : cell))
  );

const buildSheetName = (base: string, fallback: string, used: Set<string>) => {
  let name = base.replace(INVALID_SHEET_CHARS, "").trim();
  if (!name) name = fallback;
  name = name.slice(0, 31);
  let candidate = name || fallback;
  let counter = 2;
  while (used.has(candidate)) {
    const suffix = ` ${counter}`;
    const trimmed = name.slice(0, 31 - suffix.length).trim() || fallback;
    candidate = `${trimmed}${suffix}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
};

const buildExcelFormula = (formula: string, keyToCell: Record<string, string>) => {
  if (!formula) return "";
  const keys = Object.keys(keyToCell).sort((a, b) => b.length - a.length);
  let result = formula;
  for (const key of keys) {
    const pattern = new RegExp(`\\b${key}\\b`, "g");
    result = result.replace(pattern, keyToCell[key]);
  }
  return `IFERROR(${result}, "")`;
};

const quoteSheetName = (name: string) => `'${name.replace(/'/g, "''")}'`;

const toArrayBuffer = (value: ArrayBuffer | Uint8Array) => {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const applyRawTypeDropdownValidation = async (
  baseWorkbookBuffer: ArrayBuffer,
  rawSheetName: string,
  startRow: number,
  endRow: number
) => {
  try {
    const exceljsNamespace = (await import("exceljs")) as {
      Workbook?: new () => any;
      default?: { Workbook?: new () => any };
    };
    const WorkbookCtor = exceljsNamespace.Workbook ?? exceljsNamespace.default?.Workbook;
    if (!WorkbookCtor) {
      return baseWorkbookBuffer;
    }

    const workbook = new WorkbookCtor();
    await workbook.xlsx.load(baseWorkbookBuffer);

    if (typeof workbook.eachSheet === "function") {
      workbook.eachSheet((sheet: { properties?: { defaultRowHeight?: number; dyDescent?: number } }) => {
        if (!sheet.properties) {
          sheet.properties = {};
        }
        sheet.properties.defaultRowHeight = 15;
        sheet.properties.dyDescent = 0.25;
      });
    }

    const rawSheet = workbook.getWorksheet(rawSheetName);
    if (!rawSheet) {
      return baseWorkbookBuffer;
    }

    let typeColumnLetter = RAW_DELIVERY_TYPE_COLUMN_LETTER;
    const headerRowNumber = Math.max(1, startRow - 1);
    const headerRow = rawSheet.getRow(headerRowNumber);
    if (headerRow && typeof headerRow.eachCell === "function") {
      headerRow.eachCell((cell: { value?: unknown }, colNumber: number) => {
        const text = String(cell?.value ?? "").trim().toLowerCase();
        if (text === "type") {
          let letter = "";
          let columnIndex = colNumber;
          while (columnIndex > 0) {
            const remainder = (columnIndex - 1) % 26;
            letter = String.fromCharCode(65 + remainder) + letter;
            columnIndex = Math.floor((columnIndex - 1) / 26);
          }
          if (letter) {
            typeColumnLetter = letter;
          }
        }
      });
    }

    const listFormula = `"${RAW_DELIVERY_TYPE_OPTIONS.join(",")}"`;
    const validationRule = {
      type: "list",
      allowBlank: true,
      formulae: [listFormula],
      showErrorMessage: true,
      errorTitle: "Invalid type",
      error: "Select a value from the dropdown list.",
    };
    const validationRange = `${typeColumnLetter}${startRow}:${typeColumnLetter}${endRow}`;
    const dataValidationsApi = (rawSheet as { dataValidations?: { add?: (range: string, value: unknown) => void } })
      .dataValidations;

    if (dataValidationsApi?.add) {
      dataValidationsApi.add(validationRange, validationRule);
    } else {
      for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        rawSheet.getCell(`${typeColumnLetter}${rowNumber}`).dataValidation = validationRule;
      }
    }

    const updatedWorkbookBuffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
    return toArrayBuffer(updatedWorkbookBuffer);
  } catch {
    return baseWorkbookBuffer;
  }
};

const normalizeYesNo = (value: unknown) => {
  const normalized = normalizeLabel(value);
  if (["y", "yes", "true", "1"].includes(normalized)) return true;
  if (["n", "no", "false", "0"].includes(normalized)) return false;
  return null;
};

const parseSpreadsheetDateValue = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { kind: "valid" as const, date: value };
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return { kind: "valid" as const, date: new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) };
    }
  }
  return parseFlexibleDateString(normalizeCell(value));
};

const buildDateFieldError = (
  fieldLabel: string,
  value: string,
  parseResult: ReturnType<typeof parseFlexibleDateString>
) => {
  if (parseResult.kind !== "invalid") {
    return `${fieldLabel} is invalid`;
  }
  if (parseResult.code === "ambiguous") {
    return `${fieldLabel} "${value}" is ambiguous. Use YYYY-MM-DD when both day and month are 12 or less`;
  }
  return `${fieldLabel} "${value}" is invalid. Use YYYY-MM-DD, DD/MM/YY, or MM/DD/YY`;
};

const buildRawSheetDateError = (
  columnLabel: string,
  rowNumber: number,
  parseResult: ReturnType<typeof parseFlexibleDateString>
) => {
  if (parseResult.kind !== "invalid") {
    return `Invalid ${columnLabel} value in raw delivery row ${rowNumber}`;
  }
  if (parseResult.code === "ambiguous") {
    return `${columnLabel} in raw delivery row ${rowNumber} is ambiguous. Use YYYY-MM-DD when both day and month are 12 or less`;
  }
  return `${columnLabel} in raw delivery row ${rowNumber} is invalid. Use YYYY-MM-DD, DD/MM/YY, or MM/DD/YY`;
};

const parseHyperlinkTargetFromFormula = (formula: string) => {
  const match = formula.match(/HYPERLINK\(\s*"((?:[^"]|"")+)"/i);
  if (!match) return null;
  const target = match[1].replace(/""/g, "\"").trim();
  return target.length > 0 ? target : null;
};

const parseHyperlinkDisplayFromFormula = (formula: string) => {
  const match = formula.match(/HYPERLINK\(\s*"((?:[^"]|"")*)"\s*,\s*"((?:[^"]|"")*)"/i);
  if (!match) return null;
  const displayText = match[2].replace(/""/g, "\"").trim();
  return displayText.length > 0 ? displayText : null;
};

const getSheetCell = (sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) => {
  const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  return sheet[cellAddress] as (XLSX.CellObject & { l?: { Target?: unknown } }) | undefined;
};

const getSheetCellHyperlink = (sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) => {
  const cell = getSheetCell(sheet, rowIndex, columnIndex);
  if (!cell) {
    return null;
  }

  const linkTarget = typeof cell.l?.Target === "string" ? cell.l.Target.trim() : "";
  if (linkTarget && !linkTarget.startsWith("#")) {
    return linkTarget;
  }

  if (typeof cell.f === "string") {
    const formulaLink = parseHyperlinkTargetFromFormula(cell.f);
    if (formulaLink && !formulaLink.startsWith("#")) {
      return formulaLink;
    }
  }

  return null;
};

const getSheetCellHyperlinkDisplay = (sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) => {
  const cell = getSheetCell(sheet, rowIndex, columnIndex);
  if (!cell || typeof cell.f !== "string") {
    return null;
  }
  return parseHyperlinkDisplayFromFormula(cell.f);
};

const findColumnByFragments = (headers: string[], fragments: string[]) =>
  headers.findIndex((header) => fragments.every((fragment) => header.includes(fragment)));

type RawDeliveryColumnIndexes = {
  deliveredFlag: number;
  deliveryDate: number;
  reworkFlag: number;
  reworkCount: number;
  escalationFlag: number;
  escalationLevel: number;
  postDefectFlag: number;
  postDefectCount: number;
  dueDate: number;
  additionalInitiatives: number;
  type: number;
  scopeChange: number;
  processFollowed: number;
};

const getRawDeliveryColumnIndexes = (headers: string[]): RawDeliveryColumnIndexes => ({
  deliveredFlag: findColumnByFragments(headers, ["delivered", "y/n"]),
  deliveryDate: findColumnByFragments(headers, ["delivery", "date"]),
  reworkFlag: findColumnByFragments(headers, ["rework", "y/n"]),
  reworkCount: findColumnByFragments(headers, ["rework", "count"]),
  escalationFlag: findColumnByFragments(headers, ["escalat", "y/n"]),
  escalationLevel: findColumnByFragments(headers, ["escalation", "level"]),
  postDefectFlag: findColumnByFragments(headers, ["defect", "y/n"]),
  postDefectCount: findColumnByFragments(headers, ["defect", "count"]),
  dueDate: findColumnByFragments(headers, ["due", "date"]),
  additionalInitiatives: findColumnByFragments(headers, ["additional", "initiative"]),
  type: findColumnByFragments(headers, ["type"]),
  scopeChange: findColumnByFragments(headers, ["scope", "change"]),
  processFollowed: findColumnByFragments(headers, ["process", "followed"]),
});

const hasRawDeliveryRequiredColumns = (columns: RawDeliveryColumnIndexes) => {
  const hasDelivered = columns.deliveredFlag !== -1 || columns.deliveryDate !== -1;
  const hasRework = columns.reworkFlag !== -1 || columns.reworkCount !== -1;
  const hasEscalation = columns.escalationFlag !== -1 || columns.escalationLevel !== -1;
  const hasPostDefect = columns.postDefectFlag !== -1 || columns.postDefectCount !== -1;
  return hasDelivered && hasRework && hasEscalation && hasPostDefect;
};

const findRawDeliveryHeaderIndex = (rows: unknown[][]) =>
  rows.findIndex((row) => {
    const headers = row.map((cell) => normalizeLabel(cell));
    const columns = getRawDeliveryColumnIndexes(headers);
    return hasRawDeliveryRequiredColumns(columns);
  });

type ParsedRawDeliveryMetrics = {
  totalDelivered: number;
  firstTimeRightCount: number;
  escalationCount: number;
  postDeliveryDefectCount: number;
  projectsOnTimeBudget: number;
  aiAdoptionCount: number;
  reworkCount: number;
  additionalInitiatives: number;
  scopeChangeCount: number;
  formalChangeCount: number;
};

type RawDeliveryDataPayload = {
  sheetName?: string;
  headers: string[];
  rows: string[][];
  links?: (string | null)[][];
};

const parseRawDate = (value: unknown) => {
  const parsed = parseSpreadsheetDateValue(value);
  if (parsed.kind === "empty") {
    return null;
  }
  return parsed.kind === "valid" ? parsed.date : null;
};

const parseRawNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = normalizeCell(value);
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isAdditionalInitiativeTypeValue = (value: string) => value === "value add";

const isAiAdoptionTypeValue = (value: string) => value === "ai adoption" || value === "automation";

const parseRawDeliveryMetrics = (sheet: XLSX.WorkSheet): ParsedRawDeliveryMetrics | null => {
  const rows = readSheetRows(sheet);
  const headerIndex = findRawDeliveryHeaderIndex(rows);

  if (headerIndex === -1) {
    return null;
  }

  const headers = rows[headerIndex].map((cell) => normalizeLabel(cell));
  const columns = getRawDeliveryColumnIndexes(headers);

  if (!hasRawDeliveryRequiredColumns(columns)) {
    return null;
  }

  let totalDelivered = 0;
  let firstTimeRightCount = 0;
  let escalationCount = 0;
  let postDeliveryDefectCount = 0;
  let projectsOnTimeBudget = 0;
  let aiAdoptionCount = 0;
  let reworkCount = 0;
  let additionalInitiatives = 0;
  let scopeChangeCount = 0;
  let formalChangeCount = 0;
  let hasRowData = false;

  for (const row of rows.slice(headerIndex + 1)) {
    const deliveredCell =
      columns.deliveredFlag !== -1 ? row[columns.deliveredFlag] : columns.deliveryDate !== -1 ? row[columns.deliveryDate] : "";
    const reworkCell = columns.reworkFlag !== -1 ? row[columns.reworkFlag] : "";
    const escalationCell = columns.escalationFlag !== -1 ? row[columns.escalationFlag] : "";
    const postDefectCell = columns.postDefectFlag !== -1 ? row[columns.postDefectFlag] : "";
    const reworkCountCell = columns.reworkCount === -1 ? "" : row[columns.reworkCount];
    const escalationLevelCell = columns.escalationLevel === -1 ? "" : row[columns.escalationLevel];
    const postDefectCountCell = columns.postDefectCount === -1 ? "" : row[columns.postDefectCount];
    const hasTrackingValue = [
      deliveredCell,
      reworkCell,
      reworkCountCell,
      escalationCell,
      escalationLevelCell,
      postDefectCell,
      postDefectCountCell,
      columns.additionalInitiatives === -1 ? "" : row[columns.additionalInitiatives],
      columns.type === -1 ? "" : row[columns.type],
      columns.scopeChange === -1 ? "" : row[columns.scopeChange],
      columns.processFollowed === -1 ? "" : row[columns.processFollowed],
    ].some((cell) => normalizeCell(cell).length > 0);

    if (!hasTrackingValue) {
      continue;
    }

    hasRowData = true;

    const deliveredFlag = columns.deliveredFlag !== -1 ? normalizeYesNo(row[columns.deliveredFlag]) : null;
    const deliveryDate = columns.deliveryDate !== -1 ? parseRawDate(row[columns.deliveryDate]) : null;
    const delivered = deliveredFlag === null ? Boolean(deliveryDate) : deliveredFlag;

    const reworkFlag = columns.reworkFlag !== -1 ? normalizeYesNo(row[columns.reworkFlag]) : null;
    const rowReworkCount = columns.reworkCount !== -1 ? parseRawNumber(row[columns.reworkCount]) : 0;
    const hasRework = reworkFlag === true || rowReworkCount > 0;

    const escalationFlag = columns.escalationFlag !== -1 ? normalizeYesNo(row[columns.escalationFlag]) : null;
    const escalationLevel = columns.escalationLevel !== -1 ? normalizeLabel(row[columns.escalationLevel]) : "";
    const escalated =
      escalationFlag === null
        ? escalationLevel.length > 0 && escalationLevel !== "none"
        : escalationFlag;

    const postDefectFlag = columns.postDefectFlag !== -1 ? normalizeYesNo(row[columns.postDefectFlag]) : null;
    const rowPostDefectCount = columns.postDefectCount !== -1 ? parseRawNumber(row[columns.postDefectCount]) : 0;
    const postDefect = postDefectFlag === true || rowPostDefectCount > 0;

    const typeValue = columns.type !== -1 ? normalizeLabel(row[columns.type]) : "";

    const scopeChangeFlag = columns.scopeChange !== -1 ? normalizeYesNo(row[columns.scopeChange]) : null;
    const processFollowedFlag = columns.processFollowed !== -1 ? normalizeYesNo(row[columns.processFollowed]) : null;

    if (delivered) {
      totalDelivered += 1;
      if (!hasRework) {
        firstTimeRightCount += 1;
      }
      if (columns.dueDate !== -1 && columns.deliveryDate !== -1) {
        const dueDate = parseRawDate(row[columns.dueDate]);
        const rowDeliveryDate = parseRawDate(row[columns.deliveryDate]);
        const effectiveDeliveryDate = rowDeliveryDate ?? deliveryDate;
        if (dueDate && effectiveDeliveryDate && effectiveDeliveryDate.getTime() <= dueDate.getTime()) {
          projectsOnTimeBudget += 1;
        }
      }
    }
    if (escalated) {
      escalationCount += 1;
    }
    if (postDefect) {
      postDeliveryDefectCount += 1;
    }
    if (columns.reworkCount !== -1) {
      reworkCount += rowReworkCount;
    } else if (reworkFlag === true) {
      reworkCount += 1;
    }
    if (columns.type !== -1 && isAiAdoptionTypeValue(typeValue)) {
      aiAdoptionCount += 1;
    }
    if (columns.additionalInitiatives !== -1) {
      if (normalizeYesNo(row[columns.additionalInitiatives]) === true) {
        additionalInitiatives += 1;
      }
    } else if (columns.type !== -1 && isAdditionalInitiativeTypeValue(typeValue)) {
      additionalInitiatives += 1;
    }

    if (scopeChangeFlag === true) {
      scopeChangeCount += 1;
    }
    if (processFollowedFlag === true) {
      formalChangeCount += 1;
    }
  }

  if (!hasRowData) {
    return null;
  }

  return {
    totalDelivered,
    firstTimeRightCount,
    escalationCount,
    postDeliveryDefectCount,
    projectsOnTimeBudget,
    aiAdoptionCount,
    reworkCount,
    additionalInitiatives,
    scopeChangeCount,
    formalChangeCount,
  };
};

const parseRawDeliveryDataPayload = (sheet: XLSX.WorkSheet, sheetName: string): RawDeliveryDataPayload | null => {
  const rows = readSheetRows(sheet);
  const headerIndex = findRawDeliveryHeaderIndex(rows);

  if (headerIndex === -1) {
    return null;
  }

  const headers = rows[headerIndex].map((cell) => normalizeCell(cell).slice(0, 120));
  if (headers.length === 0) {
    return null;
  }

  const dataRows: string[][] = [];
  const linkRows: (string | null)[][] = [];
  const sourceRows = rows.slice(headerIndex + 1);
  for (let offset = 0; offset < sourceRows.length; offset += 1) {
    const row = sourceRows[offset];
    const sheetRowIndex = headerIndex + 1 + offset;
    const firstCell = normalizeLabel(row[0]);
    if (
      firstCell.startsWith("total delivered") ||
      firstCell.startsWith("first time right") ||
      firstCell.startsWith("escalation rate") ||
      firstCell.startsWith("post-delivery defect")
    ) {
      break;
    }

    const values = headers.map((header, index) => {
      const value = row[index];
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateOnly(value);
      }
      if (normalizeLabel(header).includes("date")) {
        const parsed = parseSpreadsheetDateValue(value);
        if (parsed.kind === "valid") {
          return formatDateOnly(parsed.date);
        }
        if (parsed.kind === "invalid") {
          throw new Error(buildRawSheetDateError(header || `Date column ${index + 1}`, sheetRowIndex + 1, parsed));
        }
      }
      const normalizedValue = normalizeCell(value);
      if (normalizedValue.length > 0) {
        return normalizedValue;
      }
      const hyperlinkDisplay = getSheetCellHyperlinkDisplay(sheet, sheetRowIndex, index);
      return hyperlinkDisplay ? hyperlinkDisplay.slice(0, 500) : normalizedValue;
    });
    const links = headers.map((_header, index) => {
      const hyperlinkTarget = getSheetCellHyperlink(sheet, sheetRowIndex, index);
      return hyperlinkTarget ? hyperlinkTarget.slice(0, 1000) : null;
    });

    const hasBusinessData = values.some(
      (cell, index) => (index === 0 ? false : cell.length > 0 || Boolean(links[index]))
    );
    if (!hasBusinessData) {
      continue;
    }
    dataRows.push(values);
    linkRows.push(links);
  }

  if (dataRows.length === 0) {
    return null;
  }

  const normalizedRows = dataRows
    .slice(0, 120)
    .map((row) => row.slice(0, 30).map((cell) => cell.slice(0, 500)));
  const normalizedLinks = linkRows
    .slice(0, 120)
    .map((row) => row.slice(0, 30).map((link) => (link ? link.slice(0, 1000) : null)));
  const hasAnyLinks = normalizedLinks.some((row) => row.some((link) => Boolean(link)));

  return {
    sheetName,
    headers,
    rows: normalizedRows,
    links: hasAnyLinks ? normalizedLinks : undefined,
  };
};

type ImportedMetricValue = { metricId: string; valueNumber: number };

const mergeMetricValues = (
  values: ImportedMetricValue[],
  overrides: ImportedMetricValue[]
): ImportedMetricValue[] => {
  const map = new Map(values.map((value) => [value.metricId, value]));
  overrides.forEach((value) => {
    map.set(value.metricId, value);
  });
  return Array.from(map.values());
};

const deriveRawMetricValues = (workbook: XLSX.WorkBook, template: Template): ImportedMetricValue[] => {
  const preferredNames = workbook.SheetNames.filter((name) =>
    RAW_DELIVERY_SHEET_NAMES.includes(normalizeLabel(name))
  );
  const candidateNames = [...preferredNames, ...workbook.SheetNames];
  const seen = new Set<string>();
  const metricByKey = new Map(
    template.goals.flatMap((goal) => goal.metrics.map((metric) => [metric.key, metric]))
  );

  for (const name of candidateNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const sheet = workbook.Sheets[name];
    const parsed = parseRawDeliveryMetrics(sheet);
    if (!parsed) continue;

    const toEntry = (key: string, valueNumber: number) => {
      const metric = metricByKey.get(key);
      if (!metric) return null;
      return { metricId: metric.id, valueNumber };
    };

    return [
      toEntry("de_projects_on_time_budget", parsed.projectsOnTimeBudget),
      toEntry("de_total_projects_delivered", parsed.totalDelivered),
      toEntry("de_total_deliverables", parsed.totalDelivered),
      toEntry("de_deliverables_accepted", parsed.firstTimeRightCount),
      toEntry("de_escalation_count", parsed.escalationCount),
      toEntry("de_post_delivery_defects", parsed.postDeliveryDefectCount),
      toEntry("de_total_deliveries", parsed.totalDelivered),
      toEntry("qp_automated_projects", parsed.aiAdoptionCount),
      toEntry("qp_rework_count", parsed.reworkCount),
      toEntry("qp_total_deliverables", parsed.totalDelivered),
      toEntry("vc_additional_initiatives", parsed.additionalInitiatives),
      toEntry("de_total_scope_requests", parsed.totalDelivered),
      toEntry("de_approved_scope_changes", parsed.scopeChangeCount),
      toEntry("qp_total_changes", parsed.scopeChangeCount),
      toEntry("qp_formal_changes", parsed.formalChangeCount),
    ].filter(Boolean) as ImportedMetricValue[];
  }

  return [];
};

const deriveRawDeliveryDataPayload = (workbook: XLSX.WorkBook): RawDeliveryDataPayload | null => {
  const preferredNames = workbook.SheetNames.filter((name) =>
    RAW_DELIVERY_SHEET_NAMES.includes(normalizeLabel(name))
  );
  const candidateNames = [...preferredNames, ...workbook.SheetNames];
  const seen = new Set<string>();

  for (const name of candidateNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const payload = parseRawDeliveryDataPayload(workbook.Sheets[name], name);
    if (payload) {
      return payload;
    }
  }

  return null;
};

export default function NewSubmissionPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<{ templates: Template[] }>("/templates"),
  });

  const templates = data?.templates ?? [];
  const [selectedId, setSelectedId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [goalNotes, setGoalNotes] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (!selectedId && templates.length > 0) {
      const preferred = templates.find((item) => (item.goals?.length ?? 0) > 1) ?? templates[0];
      setSelectedId(preferred.id);
    }
  }, [templates, selectedId]);

  const template = useMemo(
    () => templates.find((item) => item.id === selectedId) ?? null,
    [templates, selectedId]
  );

  const computedValues = useMemo(() => {
    if (!template) return new Map<string, number>();
    const variables: Record<string, number> = {};
    template.goals.forEach((goal) => {
      goal.metrics.forEach((metric) => {
        if (metric.isComputed) return;
        const parsed = parseInputNumber(values[metric.id]);
        if (parsed !== null) {
          variables[metric.key] = parsed;
        }
      });
    });

    const computed = new Map<string, number>();
    template.goals.forEach((goal) => {
      goal.metrics.forEach((metric) => {
        if (!metric.isComputed || !metric.calcFormula) return;
        const result = evaluateFormula(metric.calcFormula, variables);
        if (result === null) return;
        variables[metric.key] = result;
        computed.set(metric.id, result);
      });
    });

    return computed;
  }, [template, values]);

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      apiFetch<{ submission: unknown }>("/submissions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      showToast("success", "Submission saved successfully.");
      setValues({});
      setGoalNotes({});
      queryClient.invalidateQueries({ queryKey: ["submissions", "me"] });
    },
    onError: (error: unknown) => {
      const message = getSubmissionErrorMessage(error);
      showToast("error", message);
    },
  });

  const downloadExcelTemplate = async () => {
    if (!template) return;

    const workbook = XLSX.utils.book_new();
    const downloadGoals = template.goals.filter(
      (goal) =>
        goal.key !== "billability_utilization" &&
        normalizeLabel(goal.name) !== "billability & utilization"
    );

    const summaryRows = [
      ["Template", template.name],
      ["Period Start (YYYY-MM-DD)", ""],
      ["Period End (YYYY-MM-DD)", ""],
      [],
      ["Goal Comments"],
      ["Goal Key", "Goal Name", "Comment"],
      ...downloadGoals.map((goal) => [goal.key, goal.name, ""]),
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 36 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const usedNames = new Set<string>(["Summary"]);
    const rawSheetName = buildSheetName(RAW_DELIVERY_DEFAULT_SHEET_NAME, "RawData", usedNames);
    const rawDataStartRow = 3;
    const rawDataEndRow = rawDataStartRow + RAW_DELIVERY_MAX_ROWS - 1;
    const rawRows: unknown[][] = [
      ["Month / Period", ""],
      [
        "Sr No",
        "Ticket ID",
        "Project/Module",
        "Ticket Description",
        "Ticket Created Date",
        "Ticket Due Date",
        "Work Start Date",
        "Delivery Date",
        "Rework Count",
        "Scope Change",
        "Escalation Level",
        "Post-Delivery Defect Count",
        "Type",
        "Root Cause",
        "Process followed for Change request",
        "FTR Flag",
        "ESC Flag",
        "PDD Flag",
      ],
    ];

    for (let index = 0; index < RAW_DELIVERY_MAX_ROWS; index += 1) {
      const rowNumber = rawDataStartRow + index;
      rawRows.push([
        index + 1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        { f: `IF(H${rowNumber}="","",IF(IFERROR(VALUE(I${rowNumber}),0)=0,1,0))` },
        { f: `IF(H${rowNumber}="","",IF(AND(LOWER(TRIM(K${rowNumber}))<>"",LOWER(TRIM(K${rowNumber}))<>"none"),1,0))` },
        { f: `IF(H${rowNumber}="","",IF(IFERROR(VALUE(L${rowNumber}),0)>0,1,0))` },
      ]);
    }

    const rawTotalDeliveredRow = rawDataEndRow + 2;
    const rawFtrCountRow = rawTotalDeliveredRow + 1;
    const rawEscalationCountRow = rawTotalDeliveredRow + 2;
    const rawPostDefectCountRow = rawTotalDeliveredRow + 3;

    rawRows.push([]);
    rawRows.push([
      "Total Delivered",
      { f: `IF(COUNTIFS(H${rawDataStartRow}:H${rawDataEndRow},"<>")=0,"",COUNTIFS(H${rawDataStartRow}:H${rawDataEndRow},"<>"))` },
      "Count",
    ]);
    rawRows.push([
      "First Time Right Count",
      { f: `IF(B${rawTotalDeliveredRow}="","",SUM(P${rawDataStartRow}:P${rawDataEndRow}))` },
      "Count",
    ]);
    rawRows.push([
      "Escalation Count",
      { f: `IF(B${rawTotalDeliveredRow}="","",SUM(Q${rawDataStartRow}:Q${rawDataEndRow}))` },
      "Count",
    ]);
    rawRows.push([
      "Post-Delivery Defect Count",
      { f: `IF(B${rawTotalDeliveredRow}="","",SUM(R${rawDataStartRow}:R${rawDataEndRow}))` },
      "Count",
    ]);
    rawRows.push([
      "First Time Right (%)",
      {
        f: `IF(B${rawTotalDeliveredRow}="","",ROUND((B${rawFtrCountRow}/B${rawTotalDeliveredRow})*100,2))`,
      },
      "%",
    ]);
    rawRows.push([
      "Escalation Rate (%)",
      {
        f: `IF(B${rawTotalDeliveredRow}="","",ROUND((B${rawEscalationCountRow}/B${rawTotalDeliveredRow})*100,2))`,
      },
      "%",
    ]);
    rawRows.push([
      "Post-Delivery Defect Rate (%)",
      {
        f: `IF(B${rawTotalDeliveredRow}="","",ROUND((B${rawPostDefectCountRow}/B${rawTotalDeliveredRow})*100,2))`,
      },
      "%",
    ]);

    const rawSheet = XLSX.utils.aoa_to_sheet(rawRows);
    rawSheet["!cols"] = [
      { wch: 8 },
      { wch: 18 },
      { wch: 28 },
      { wch: 34 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 12 },
      { wch: 24 },
      { wch: 34 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(workbook, rawSheet, rawSheetName);

    const rawSheetRef = quoteSheetName(rawSheetName);
    const rawMetricFormulaByKey: Record<string, string> = {
      de_projects_on_time_budget: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",SUMPRODUCT(--(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow}<>""),--(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow}<=${rawSheetRef}!$F$${rawDataStartRow}:$F$${rawDataEndRow})))`,
      de_total_projects_delivered: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>"))`,
      de_total_deliverables: `IFERROR(${rawSheetRef}!B${rawTotalDeliveredRow}, "")`,
      de_deliverables_accepted: `IFERROR(${rawSheetRef}!B${rawFtrCountRow}, "")`,
      de_escalation_count: `IFERROR(${rawSheetRef}!B${rawEscalationCountRow}, "")`,
      de_post_delivery_defects: `IFERROR(${rawSheetRef}!B${rawPostDefectCountRow}, "")`,
      de_total_deliveries: `IFERROR(${rawSheetRef}!B${rawTotalDeliveredRow}, "")`,
      qp_automated_projects: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$M$${rawDataStartRow}:$M$${rawDataEndRow},"AI Adoption"))`,
      qp_rework_count: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",SUM(${rawSheetRef}!$I$${rawDataStartRow}:$I$${rawDataEndRow}))`,
      qp_total_deliverables: `IFERROR(${rawSheetRef}!B${rawTotalDeliveredRow}, "")`,
      vc_additional_initiatives: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$M$${rawDataStartRow}:$M$${rawDataEndRow},"Value Add"))`,
      de_total_scope_requests: `IFERROR(${rawSheetRef}!B${rawTotalDeliveredRow}, "")`,
      de_approved_scope_changes: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$J$${rawDataStartRow}:$J$${rawDataEndRow},"*Yes*",${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>"))`,
      qp_total_changes: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$J$${rawDataStartRow}:$J$${rawDataEndRow},"*Yes*",${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>"))`,
      qp_formal_changes: `IF(COUNTIFS(${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>")=0,"",COUNTIFS(${rawSheetRef}!$O$${rawDataStartRow}:$O$${rawDataEndRow},"*Yes*",${rawSheetRef}!$H$${rawDataStartRow}:$H$${rawDataEndRow},"<>"))`,
    };

    downloadGoals.forEach((goal, index) => {
      const sheetName = buildSheetName(goal.name, `Goal ${index + 1}`, usedNames);
      const rows = [
        ["Goal Key", goal.key],
        ["Goal Name", goal.name],
        ["Description", goal.description ?? ""],
        ["Goal Comment", ""],
        [],
        ["Metric Key", "Metric Label", "Type", "Required", "Definition", "Value", "Comment"],
        ...goal.metrics.map((metric) => [
          metric.key,
          metric.label,
          metric.type,
          metric.isComputed
            ? "Auto"
            : rawMetricFormulaByKey[metric.key]
              ? "Auto (Raw Sheet)"
              : metric.required
                ? "Yes"
                : "No",
          metric.definition ?? "",
          "",
          "",
        ]),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 22 },
        { wch: 32 },
        { wch: 12 },
        { wch: 10 },
        { wch: 56 },
        { wch: 16 },
        { wch: 40 },
      ];
      const headerIndex = rows.findIndex((row) => normalizeLabel(row[0]) === "metric key");
      const headerRow = rows[headerIndex] ?? [];
      const valueColIndex = headerRow.findIndex((cell) => normalizeLabel(cell) === "value");
      if (headerIndex !== -1 && valueColIndex !== -1) {
        const keyToCell: Record<string, string> = {};
        goal.metrics.forEach((metric, metricIndex) => {
          const rowIndex = headerIndex + 1 + metricIndex;
          const addr = XLSX.utils.encode_cell({ r: rowIndex, c: valueColIndex });
          keyToCell[metric.key] = addr;
        });

        goal.metrics.forEach((metric, metricIndex) => {
          const rowIndex = headerIndex + 1 + metricIndex;
          const addr = XLSX.utils.encode_cell({ r: rowIndex, c: valueColIndex });
          const rawMetricFormula = rawMetricFormulaByKey[metric.key];
          if (rawMetricFormula) {
            sheet[addr] = { f: rawMetricFormula };
            return;
          }
          if (!metric.isComputed || !metric.calcFormula) return;
          const excelFormula = buildExcelFormula(metric.calcFormula, keyToCell);
          if (!excelFormula) return;
          sheet[addr] = { f: excelFormula };
        });
      }
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });

    const baseExcelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const excelBuffer = await applyRawTypeDropdownValidation(
      baseExcelBuffer,
      rawSheetName,
      rawDataStartRow,
      rawDataEndRow
    );
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = template.name
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9-_]/g, "")
      .toLowerCase();
    link.download = `${safeName || "kpi-template"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const parseLegacyWorkbook = (workbook: XLSX.WorkBook) => {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error("No worksheet found.");
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows = readSheetRows(sheet);
    const cleanedRows = rawRows
      .map((row) => row.map((cell) => (cell === undefined ? "" : cell)))
      .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0));
    if (cleanedRows.length === 0) {
      throw new Error("The file is empty.");
    }
    const headers = cleanedRows[0].map((cell) => String(cell).trim());
    const rows = cleanedRows.slice(1).map((row) =>
      row.map((cell, index) => normalizeCell(cell, headers[index]))
    );
    return { headers, rows };
  };

  const findSummarySheetName = (workbook: XLSX.WorkBook) =>
    workbook.SheetNames.find((name) => SUMMARY_SHEET_NAMES.includes(normalizeLabel(name)));

  const isMultiSheetWorkbook = (workbook: XLSX.WorkBook) => {
    if (findSummarySheetName(workbook)) {
      return true;
    }
    return workbook.SheetNames.some((name) => {
      const sheet = workbook.Sheets[name];
      const rows = readSheetRows(sheet);
      return rows.some((row) => normalizeLabel(row[0]) === "goal key");
    });
  };

  const parseSummarySheet = (rows: unknown[][]) => {
    const findValue = (prefix: string) => {
      const row = rows.find((current) => normalizeLabel(current[0]).startsWith(prefix));
      return row ? row[1] : "";
    };

    const templateName = normalizeCell(findValue("template"));
    const periodStart = normalizeCell(findValue("period start"), "periodStart");
    const periodEnd = normalizeCell(findValue("period end"), "periodEnd");

    const notes = new Map<string, string>();
    const headerIndex = rows.findIndex((row) => normalizeLabel(row[0]) === "goal key");
    if (headerIndex !== -1) {
      const headerRow = rows[headerIndex].map((cell) => normalizeLabel(cell));
      const keyIndex = headerRow.indexOf("goal key");
      const commentIndex = headerRow.indexOf("comment");
      const noteIndex = commentIndex !== -1 ? commentIndex : headerRow.indexOf("note");
      if (keyIndex !== -1 && noteIndex !== -1) {
        for (const row of rows.slice(headerIndex + 1)) {
          const key = normalizeCell(row[keyIndex]);
          const note = normalizeCell(row[noteIndex]);
          if (key && note) {
            notes.set(key, note);
          }
        }
      }
    }

    return { templateName, periodStart, periodEnd, notes };
  };

  const findGoalSheet = (workbook: XLSX.WorkBook, goal: Template["goals"][number]) => {
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = readSheetRows(sheet);
      const goalKeyRow = rows.find((row) => normalizeLabel(row[0]) === "goal key");
      const goalKey = goalKeyRow ? normalizeCell(goalKeyRow[1]) : "";
      if (goalKey && goalKey === goal.key) {
        return { name, sheet };
      }
    }

    const fallbackName = workbook.SheetNames.find((name) => {
      const label = normalizeLabel(name);
      return label === normalizeLabel(goal.name) || label === normalizeLabel(goal.key);
    });

    if (fallbackName) {
      return { name: fallbackName, sheet: workbook.Sheets[fallbackName] };
    }

    return null;
  };

  const parseGoalSheet = (
    sheet: XLSX.WorkSheet,
    sheetName: string,
    goal: Template["goals"][number],
    autoFilledMetricKeys: Set<string>
  ) => {
    const rows = readSheetRows(sheet);
    const goalKeyRow = rows.find((row) => normalizeLabel(row[0]) === "goal key");
    if (!goalKeyRow) {
      throw new Error(`Sheet "${sheetName}" is missing the Goal Key row.`);
    }

    const goalKey = normalizeCell(goalKeyRow[1]);
    if (goalKey && goalKey !== goal.key) {
      throw new Error(`Sheet "${sheetName}" is for goal "${goalKey}" not "${goal.key}".`);
    }

    const goalNoteRow = rows.find((row) => {
      const label = normalizeLabel(row[0]);
      return label === "goal note" || label === "goal comment";
    });
    const goalNote = goalNoteRow ? normalizeCell(goalNoteRow[1]) : "";

    const headerIndex = rows.findIndex((row) => normalizeLabel(row[0]) === "metric key");
    if (headerIndex === -1) {
      throw new Error(`Sheet "${sheetName}" is missing the metric table.`);
    }

    const headerRow = rows[headerIndex].map((cell) => normalizeLabel(cell));
    const keyIndex = headerRow.indexOf("metric key");
    const valueIndex = headerRow.indexOf("value");
    if (keyIndex === -1 || valueIndex === -1) {
      throw new Error(`Sheet "${sheetName}" must include Metric Key and Value columns.`);
    }

    const metricsByKey = new Map(goal.metrics.map((metric) => [metric.key, metric]));
    const providedKeys = new Set<string>();
    const values: { metricId: string; valueNumber: number }[] = [];

    for (const row of rows.slice(headerIndex + 1)) {
      const metricKey = normalizeCell(row[keyIndex]);
      if (!metricKey) continue;
      const metric = metricsByKey.get(metricKey);
      if (!metric) {
        throw new Error(`Unknown metric key "${metricKey}" in sheet "${sheetName}".`);
      }
      providedKeys.add(metricKey);

      if (metric.isComputed) {
        continue;
      }

      let parsedValue: number | null = null;
      try {
        parsedValue = parseNumericValue(row[valueIndex]);
      } catch {
        throw new Error(`Invalid number for ${metric.label} in sheet "${sheetName}".`);
      }

      if (parsedValue === null) {
        if (metric.required && !autoFilledMetricKeys.has(metric.key)) {
          throw new Error(`Missing value for ${metric.label} in sheet "${sheetName}".`);
        }
        continue;
      }

      values.push({ metricId: metric.id, valueNumber: parsedValue });
    }

    for (const metric of goal.metrics) {
      if (metric.required && !providedKeys.has(metric.key) && !autoFilledMetricKeys.has(metric.key)) {
        throw new Error(`Missing row for required metric ${metric.label} in sheet "${sheetName}".`);
      }
    }

    return { values, goalNote };
  };

  const parseMultiSheetWorkbook = (workbook: XLSX.WorkBook) => {
    if (!template) {
      throw new Error("Template is missing.");
    }

    const summarySheetName = findSummarySheetName(workbook);
    if (!summarySheetName) {
      throw new Error("Summary sheet not found. Download the latest template.");
    }

    const summaryRows = readSheetRows(workbook.Sheets[summarySheetName]);
    const summary = parseSummarySheet(summaryRows);

    if (
      summary.templateName &&
      normalizeLabel(summary.templateName) !== normalizeLabel(template.name)
    ) {
      throw new Error(
        `Template mismatch. This file is for "${summary.templateName}". Please select the matching template.`
      );
    }

    if (!summary.periodStart || !summary.periodEnd) {
      throw new Error("Summary sheet must include period start and period end.");
    }

    const values: { metricId: string; valueNumber: number }[] = [];
    const goalNotesPayload: { goalId: string; note: string }[] = [];

    for (const goal of template.goals) {
      const sheetInfo = findGoalSheet(workbook, goal);
      if (!sheetInfo) {
        throw new Error(`Missing sheet for goal ${goal.name}.`);
      }

      const parsed = parseGoalSheet(sheetInfo.sheet, sheetInfo.name, goal, RAW_AUTO_METRIC_KEYS);
      values.push(...parsed.values);
      const note = summary.notes.get(goal.key) || parsed.goalNote;
      if (note) {
        goalNotesPayload.push({ goalId: goal.id, note });
      }
    }

    const rawDerivedValues = deriveRawMetricValues(workbook, template);
    const mergedValues = mergeMetricValues(values, rawDerivedValues);
    const rawDeliveryData = deriveRawDeliveryDataPayload(workbook);
    const providedMetricIds = new Set(mergedValues.map((value) => value.metricId));
    const missingRequiredMetric = template.goals
      .flatMap((goal) => goal.metrics)
      .find((metric) => metric.required && !metric.isComputed && !providedMetricIds.has(metric.id));
    if (missingRequiredMetric) {
      throw new Error(
        `Missing value for ${missingRequiredMetric.label}. Fill it manually or provide it through the raw data sheet.`
      );
    }

    return {
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      values: mergedValues,
      goalNotes: goalNotesPayload,
      rawDeliveryData,
    };
  };

  const submitRows = async (rows: string[][], headers: string[]) => {
    if (!template) return;
    setImporting(true);
    let successCount = 0;
    const errors: string[] = [];

    const headerMap = new Map<string, number>();
    headers.forEach((header, index) => {
      headerMap.set(header, index);
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const periodStartValue = (row[headerMap.get("periodStart") ?? -1] ?? "").trim();
      const periodEndValue = (row[headerMap.get("periodEnd") ?? -1] ?? "").trim();

      if (!periodStartValue || !periodEndValue) {
        errors.push(`Row ${rowIndex + 2}: periodStart and periodEnd are required.`);
        continue;
      }

      const parsedPeriodStart = parseFlexibleDateString(periodStartValue);
      if (parsedPeriodStart.kind !== "valid") {
        errors.push(`Row ${rowIndex + 2}: ${buildDateFieldError("periodStart", periodStartValue, parsedPeriodStart)}.`);
        continue;
      }

      const parsedPeriodEnd = parseFlexibleDateString(periodEndValue);
      if (parsedPeriodEnd.kind !== "valid") {
        errors.push(`Row ${rowIndex + 2}: ${buildDateFieldError("periodEnd", periodEndValue, parsedPeriodEnd)}.`);
        continue;
      }

      const submittedValues: { metricId: string; valueNumber: number }[] = [];
      let rowError = "";

      for (const goal of template.goals) {
        for (const metric of goal.metrics) {
          if (metric.isComputed) {
            continue;
          }
          const headerIndex = headerMap.get(metric.key);
          const raw = headerIndex !== undefined ? row[headerIndex] ?? "" : "";
          let parsedValue: number | null = null;

          try {
            parsedValue = parseNumericValue(raw);
          } catch {
            rowError = `Row ${rowIndex + 2}: invalid number for ${metric.label}.`;
            break;
          }

          if (parsedValue === null) {
            if (metric.required) {
              rowError = `Row ${rowIndex + 2}: missing value for ${metric.label}.`;
              break;
            }
            continue;
          }

          submittedValues.push({ metricId: metric.id, valueNumber: parsedValue });
        }
        if (rowError) break;
      }

      if (rowError) {
        errors.push(rowError);
        continue;
      }

      const goalNotePayload = template.goals
        .map((goal) => {
          const headerIndex = headerMap.get(`goal_note_${goal.key}`);
          const raw = headerIndex !== undefined ? (row[headerIndex] ?? "").trim() : "";
          if (!raw) return null;
          return { goalId: goal.id, note: raw };
        })
        .filter(Boolean) as { goalId: string; note: string }[];

      try {
        await apiFetch<{ submission: unknown }>("/submissions", {
          method: "POST",
          body: JSON.stringify({
            templateId: template.id,
            periodStart: parsedPeriodStart.date.toISOString(),
            periodEnd: parsedPeriodEnd.date.toISOString(),
            values: submittedValues,
            goalNotes: goalNotePayload,
          }),
        });
        successCount += 1;
      } catch (err) {
        errors.push(`Row ${rowIndex + 2}: ${getSubmissionErrorMessage(err)}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["submissions", "me"] });
    setImporting(false);
    if (errors.length > 0) {
      const message = errors.slice(0, 3).join(" ");
      showToast("error", message);
    }
    if (successCount > 0) {
      const message = `Imported ${successCount} row(s) successfully.`;
      showToast("success", message);
    }
  };

  const submitMultiSheetWorkbook = async (workbook: XLSX.WorkBook) => {
    if (!template) return;

    setImporting(true);

    try {
      const parsed = parseMultiSheetWorkbook(workbook);
      const parsedPeriodStart = parseFlexibleDateString(parsed.periodStart);
      const parsedPeriodEnd = parseFlexibleDateString(parsed.periodEnd);

      if (parsedPeriodStart.kind !== "valid") {
        throw new Error(buildDateFieldError("Period start", parsed.periodStart, parsedPeriodStart));
      }

      if (parsedPeriodEnd.kind !== "valid") {
        throw new Error(buildDateFieldError("Period end", parsed.periodEnd, parsedPeriodEnd));
      }

      const periodStartDate = parsedPeriodStart.date;
      const periodEndDate = parsedPeriodEnd.date;

      if (periodStartDate > periodEndDate) {
        throw new Error("Period start must be before period end.");
      }

      if (parsed.values.length === 0) {
        throw new Error("No metric values found.");
      }

      await apiFetch<{ submission: unknown }>("/submissions", {
        method: "POST",
        body: JSON.stringify({
          templateId: template.id,
          periodStart: periodStartDate.toISOString(),
          periodEnd: periodEndDate.toISOString(),
          values: parsed.values,
          goalNotes: parsed.goalNotes,
          rawDeliveryData: parsed.rawDeliveryData ?? undefined,
        }),
      });

      queryClient.invalidateQueries({ queryKey: ["submissions", "me"] });
      showToast("success", "Imported 1 submission successfully.");
    } catch (err) {
      const message = getSubmissionErrorMessage(err);
      showToast("error", message);
    } finally {
      setImporting(false);
    }
  };

  const handleSpreadsheetUpload = async (file: File) => {
    if (!template) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });

      if (isMultiSheetWorkbook(workbook)) {
        await submitMultiSheetWorkbook(workbook);
        return;
      }

      const { headers, rows } = parseLegacyWorkbook(workbook);
      if (rows.length === 0) {
        const message = "The file has no data rows.";
        showToast("error", message);
        return;
      }
      await submitRows(rows, headers);
    } catch (err) {
      setImporting(false);
      const message = (err as Error).message ?? "Unable to read the uploaded file.";
      showToast("error", message);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!template) {
      const message = "Please select a template.";
      showToast("error", message);
      return;
    }

    if (!periodStart || !periodEnd) {
      const message = "Please set a period start and end date.";
      showToast("error", message);
      return;
    }

    if (new Date(periodStart) > new Date(periodEnd)) {
      const message = "Period start must be before period end.";
      showToast("error", message);
      return;
    }

    const submittedValues: { metricId: string; valueNumber: number }[] = [];

    for (const goal of template.goals) {
      for (const metric of goal.metrics) {
        if (metric.isComputed) continue;
        const raw = values[metric.id];
        if (raw === undefined || raw === "") {
          if (metric.required) {
            const message = `Missing value for ${metric.label}.`;
            showToast("error", message);
            return;
          }
          continue;
        }

        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          const message = `Invalid number for ${metric.label}.`;
          showToast("error", message);
          return;
        }

        submittedValues.push({ metricId: metric.id, valueNumber: parsed });
      }
    }

    if (submittedValues.length === 0) {
      const message = "Please provide at least one metric value.";
      showToast("error", message);
      return;
    }

    mutation.mutate({
      templateId: template.id,
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
      values: submittedValues,
      goalNotes: Object.entries(goalNotes)
        .filter(([, note]) => note.trim().length > 0)
        .map(([goalId, note]) => ({ goalId, note: note.trim() })),
    });
  };

  if (templates.length === 0) {
    return (
      <div className="page">
        <div className="panel empty-state">
          <h3>No templates available</h3>
          <p>Ask your admin to create a KPI template before submitting data.</p>
        </div>
      </div>
    );
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
          <h3>Submit KPI Data</h3>
          <span className="panel-sub">Download the multi-sheet Excel template or import a completed file.</span>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={downloadExcelTemplate}>
            Download Excel Template
          </button>
          <label className="btn btn-primary file-upload">
            {importing ? "Importing..." : "Import Excel/CSV"}
            <input
              type="file"
              accept=".csv,.xlsx"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleSpreadsheetUpload(file);
                }
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Template</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Period start</span>
            <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>

          <label className="form-field">
            <span>Period end</span>
            <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
        </div>

        <div className="goal-grid">
          {template?.goals.map((goal) => (
            <div key={goal.id} className="goal-section">
              <div className="goal-header">
                <div>
                  <h4>{goal.name}</h4>
                  {goal.description && <p>{goal.description}</p>}
                </div>
              </div>
              <div className="metric-grid">
                {goal.metrics.map((metric) => {
                  const computedValue = metric.isComputed ? computedValues.get(metric.id) : null;
                  return (
                    <label
                      className={`form-field${metric.isComputed ? " metric-computed" : ""}`}
                      key={metric.id}
                    >
                      <span className="metric-label">
                        {metric.label} {!metric.isComputed && metric.required ? "*" : ""}
                        {metric.isComputed && <span className="metric-tag">Auto</span>}
                      </span>
                      {metric.isComputed ? (
                        <div className="metric-readonly">{formatMetricValue(computedValue, metric.type)}</div>
                      ) : (
                        <input
                          type="number"
                          placeholder={`Enter ${metric.label}`}
                          value={values[metric.id] ?? ""}
                          onChange={(event) => setValues((prev) => ({ ...prev, [metric.id]: event.target.value }))}
                        />
                      )}
                      {metric.definition && <span className="metric-meta">{metric.definition}</span>}
                      {metric.formulaText && <span className="metric-meta">Formula: {metric.formulaText}</span>}
                      {metric.targetText && <span className="metric-meta">Target: {metric.targetText}</span>}
                      {metric.frequency && <span className="metric-meta">Frequency: {metric.frequency}</span>}
                    </label>
                  );
                })}
              </div>
              <label className="form-field goal-note">
                <span>{goal.name} summary</span>
                <textarea
                  rows={3}
                  placeholder={`Notes for ${goal.name} (optional)`}
                  value={goalNotes[goal.id] ?? ""}
                  onChange={(event) => setGoalNotes((prev) => ({ ...prev, [goal.id]: event.target.value }))}
                />
              </label>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Submit KPI"}
        </button>
      </form>
    </div>
  );
}
