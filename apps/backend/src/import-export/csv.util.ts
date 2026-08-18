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

export function sanitizeCsvCell(value: unknown): string {
  const str = toCellString(value);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const sanitizedRows = rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col, sanitizeCsvCell(row[col])])),
  );
  return stringify(sanitizedRows, { header: true, columns });
}
