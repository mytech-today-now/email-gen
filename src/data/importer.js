import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "@e965/xlsx";
import { AppError } from "../utils/errors.js";
import { normalizeRecords } from "./normalizer.js";
import { parseStaticJavaScriptData } from "./formats/staticJsParser.js";

function extOf(filename = "") {
  return path.extname(filename).toLowerCase();
}

function recordsFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["records", "items", "rows", "data", "allRestaurants"]) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  throw new AppError(
    "UNSUPPORTED_JSON_SHAPE",
    "JSON imports must be an array or an object containing records/items/rows/data.",
    400
  );
}

function parseDelimited(buffer, delimiter) {
  return parseCsv(buffer.toString("utf8"), {
    columns: true,
    skip_empty_lines: false,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    delimiter
  });
}

function detectDelimiter(buffer) {
  const firstLine = buffer.toString("utf8").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
}

function parseSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "", raw: false });
}

export function parseImportBuffer({ buffer, filename, limits }) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new AppError("EMPTY_IMPORT", "Import file is empty.", 400);
    }
    if (buffer.length > limits.uploadBytes) {
      throw new AppError("UPLOAD_TOO_LARGE", "Import file exceeds the configured upload size limit.", 413);
    }

    const extension = extOf(filename);
    let records;
    if ([".csv"].includes(extension)) records = parseDelimited(buffer, ",");
    else if ([".tsv", ".tab"].includes(extension)) records = parseDelimited(buffer, "\t");
    else if ([".txt"].includes(extension)) records = parseDelimited(buffer, detectDelimiter(buffer));
    else if ([".json"].includes(extension)) records = recordsFromJson(JSON.parse(buffer.toString("utf8")));
    else if ([".js", ".mjs"].includes(extension))
      records = recordsFromJson(parseStaticJavaScriptData(buffer.toString("utf8")));
    else if ([".xls", ".xlsx", ".ods"].includes(extension)) records = parseSpreadsheet(buffer);
    else if (extension === ".numbers") {
      throw new AppError(
        "UNSUPPORTED_NUMBERS_FILE",
        "Apple Numbers files are not parsed directly. Export from Numbers as CSV or XLSX and import that file.",
        415
      );
    } else {
      throw new AppError(
        "UNSUPPORTED_IMPORT_TYPE",
        `Unsupported import file type '${extension || "unknown"}'.`,
        415
      );
    }

    return normalizeRecords(records, { sourceName: filename, limits });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "IMPORT_PARSE_FAILED",
      `Could not parse '${filename}'. Check that the selected file matches its extension and has valid tabular data.`,
      400,
      { parserMessage: error.message }
    );
  }
}

export async function parseGoogleSheetsCsvUrl(url, { limits, fetchImpl = fetch }) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError("INVALID_GOOGLE_SHEET_URL", "Google Sheets CSV URL must use http or https.", 400);
  }
  const response = await fetchImpl(parsed, { redirect: "follow" });
  if (!response.ok) {
    throw new AppError("GOOGLE_SHEET_FETCH_FAILED", `CSV export returned HTTP ${response.status}.`, 400);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return parseImportBuffer({ buffer, filename: "google-sheet.csv", limits });
}
