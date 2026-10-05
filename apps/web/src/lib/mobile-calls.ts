export type CallType = "incoming" | "outgoing" | "missed" | "rejected" | "blocked" | "unknown";

export interface MobileCallRow {
  id: string;
  phoneNumber: string;
  phoneNumberNormalized: string;
  contactName: string | null;
  callType: CallType;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  simSlot: string | null;
  simName: string | null;
  source: string;
  employee: { id: string; fullName: string };
  device: { id: string; name: string; deviceId: string };
  lead: { id: string; fullName: string } | null;
}

export interface MobileCallDetail extends MobileCallRow {
  externalId: string | null;
  androidCallId: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  syncedAt: string;
}

export interface MobileCallList {
  items: MobileCallRow[];
  page: number;
  limit: number;
  total: number;
}

export interface MobileDevice {
  id: string;
  deviceId: string;
  name: string;
  phoneNumber: string | null;
  status: "ACTIVE" | "DISABLED";
  employee: { id: string; fullName: string; employeeNumber: string };
  tokenLastFour: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  lastExternalCallId: string | null;
  callCount?: number;
  token?: string;
}

export interface CallSummaryRow {
  employeeId: string;
  employeeName: string;
  incoming: number;
  outgoing: number;
  missed: number;
  other: number;
  totalCalls: number;
  totalDurationSeconds: number;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const CALL_TYPE_TONE: Record<CallType, "neutral" | "success" | "warning" | "danger" | "info"> = {
  incoming: "info",
  outgoing: "success",
  missed: "danger",
  rejected: "warning",
  blocked: "warning",
  unknown: "neutral",
};

// ---- history file import (parsed in the browser; sent to the same ingest path as the phone) ----

export type ImportRecord = Record<string, string | number | null>;
export const IMPORT_BATCH_SIZE = 500;
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

const CSV_ALIASES: Record<string, string> = {
  number: "phone_number",
  phone: "phone_number",
  type: "call_type",
  date: "started_at",
  time: "started_at",
  duration: "duration_seconds",
  name: "contact_name",
};

/**
 * Turns a call-history file into records for POST .../devices/:id/import.
 * Supported: Zulivio CSV/JSON (phone_number, call_type, started_at,
 * duration_seconds, contact_name…) and the calls XML written by "SMS Backup
 * & Restore" (<call number date type duration contact_name/>), whose type
 * codes are Android's CallLog.Calls.TYPE constants the server already maps.
 */
export function parseCallHistoryFile(name: string, text: string): ImportRecord[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) {
    const data: unknown = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data as { calls?: unknown }).calls;
    if (!Array.isArray(list)) throw new Error("JSON must be an array of calls or { \"calls\": [...] }.");
    return list as ImportRecord[];
  }
  if (lower.endsWith(".xml")) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("That XML file could not be read.");
    return Array.from(doc.querySelectorAll("call")).map((el) => {
      const contact = el.getAttribute("contact_name");
      return {
        phone_number: el.getAttribute("number") ?? "",
        call_type: Number(el.getAttribute("type")),
        started_at: Number(el.getAttribute("date")),
        duration_seconds: Number(el.getAttribute("duration") ?? 0),
        contact_name: contact && contact !== "(Unknown)" ? contact : null,
      };
    });
  }
  if (lower.endsWith(".csv")) {
    const [header, ...rest] = parseCsv(text);
    if (!header) throw new Error("The CSV file is empty.");
    const keys = header.map((h) => {
      const k = h.trim().toLowerCase().replace(/\s+/g, "_");
      return CSV_ALIASES[k] ?? k;
    });
    if (!keys.includes("phone_number") || !keys.includes("started_at")) {
      throw new Error("CSV needs at least phone_number, call_type and started_at columns.");
    }
    return rest.map((cells) => {
      const rec: ImportRecord = {};
      keys.forEach((k, i) => {
        const v = (cells[i] ?? "").trim();
        if (v === "") return;
        rec[k] = k === "duration_seconds" || (k === "started_at" && /^\d+$/.test(v)) ? Number(v) : v;
      });
      return rec;
    });
  }
  throw new Error("Unsupported file type — use .xml (SMS Backup & Restore), .csv or .json.");
}
