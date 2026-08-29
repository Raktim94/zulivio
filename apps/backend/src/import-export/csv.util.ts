import { stringify } from "csv-stringify/sync";

/**
 * Neutralizes spreadsheet formula injection: a leading =, +, -, or @ in a
 * cell is interpreted as a formula by Excel/Sheets when the CSV is opened.
 * Prefixing with a single quote forces it to be read as literal text.
 */
function toCellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      // Plain objects/arrays/functions/symbols have no meaningful
      // stringification here — JSON.stringify avoids silently writing
      // "[object Object]" into the exported cell.
      return JSON.stringify(value) ?? "";
  }
}

/**
 * A bare digit string long enough that Excel/Sheets will auto-detect the CSV
 * column as Numbers and, past ~11 digits, re-render it in scientific
 * notation (e.g. a 12-digit phone number like "918605123456" displays as
 * "9.18605E+11") -- which hides the real digits and, on copy, often pastes
 * that truncated display text instead of the original number.
 */
const LOOKS_LIKE_LONG_NUMBER = /^\+?\d{6,}$/;

export function sanitizeCsvCell(value: unknown, opts: { forceText?: boolean } = {}): string {
  const str = toCellString(value);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  if (opts.forceText && LOOKS_LIKE_LONG_NUMBER.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * `textColumns` names columns whose values must stay literal text when the
 * CSV is opened in a spreadsheet (phone numbers, long ID numbers) rather
 * than being auto-detected as Numbers -- see LOOKS_LIKE_LONG_NUMBER above.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[], textColumns: string[] = []): string {
  const textColumnSet = new Set(textColumns);
  const sanitizedRows = rows.map((row) =>
    Object.fromEntries(
      columns.map((col) => [col, sanitizeCsvCell(row[col], { forceText: textColumnSet.has(col) })]),
    ),
  );
  return stringify(sanitizedRows, { header: true, columns });
}
