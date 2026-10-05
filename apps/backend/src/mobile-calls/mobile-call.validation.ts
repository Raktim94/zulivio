import { createHash } from "node:crypto";
import { MobileCallType } from "@prisma/client";
import { normalizeCallNumber } from "./mobile-phone.util";

export const MAX_BULK_CALLS = 500;
export const MAX_METADATA_BYTES = 2048;
export const MAX_METADATA_KEYS = 20;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const EARLIEST_CALL = Date.UTC(2000, 0, 1);
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export type ValidationCode =
  | "INVALID_PHONE_NUMBER"
  | "INVALID_CALL_TYPE"
  | "INVALID_TIMESTAMP"
  | "INVALID_DURATION"
  | "INVALID_FIELD"
  | "INVALID_METADATA";

export class CallValidationError extends Error {
  constructor(
    public readonly code: ValidationCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ValidatedCall {
  phoneNumberOriginal: string;
  phoneNumberNormalized: string;
  phoneLast10: string;
  phoneReliable: boolean;
  contactName: string | null;
  callType: MobileCallType;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  simSlot: string | null;
  simName: string | null;
  androidCallId: string | null;
  externalId: string | null;
  source: string;
  metadata: Record<string, string | number | boolean | null> | null;
}

// Android android.provider.CallLog.Calls.TYPE constants, as a native app (or
// an exported call log) would send them.
const ANDROID_TYPE_CODES: Record<number, MobileCallType> = {
  1: MobileCallType.INCOMING,
  2: MobileCallType.OUTGOING,
  3: MobileCallType.MISSED,
  4: MobileCallType.UNKNOWN, // voicemail
  5: MobileCallType.REJECTED,
  6: MobileCallType.BLOCKED,
  7: MobileCallType.UNKNOWN, // answered externally
};

const TYPE_ALIASES: Record<string, MobileCallType> = {
  incoming: MobileCallType.INCOMING,
  in: MobileCallType.INCOMING,
  received: MobileCallType.INCOMING,
  outgoing: MobileCallType.OUTGOING,
  out: MobileCallType.OUTGOING,
  dialed: MobileCallType.OUTGOING,
  missed: MobileCallType.MISSED,
  rejected: MobileCallType.REJECTED,
  declined: MobileCallType.REJECTED,
  blocked: MobileCallType.BLOCKED,
  unknown: MobileCallType.UNKNOWN,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strips control characters and angle brackets so values are inert in any later HTML/CSV context. */
export function cleanText(value: string, max: number): string {
  return value
    .replace(/[\p{Cc}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function optionalText(raw: unknown, field: string, max: number): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new CallValidationError("INVALID_FIELD", `${field} must be a string.`);
  }
  const cleaned = cleanText(String(raw), max);
  return cleaned || null;
}

function parseTimestamp(raw: unknown, field: string): Date {
  let ms: number;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // < 1e11 reads as epoch seconds (year 5138 in ms), otherwise epoch ms.
    ms = raw < 1e11 ? raw * 1000 : raw;
  } else if (typeof raw === "string" && raw.trim()) {
    const text = raw.trim();
    if (/^\d{9,13}$/.test(text)) {
      const n = Number(text);
      ms = n < 1e11 ? n * 1000 : n;
    } else {
      // ISO 8601 only, and an explicit offset or Z is mandatory: a bare
      // local time would be silently misread in the server's timezone.
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s?(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
        throw new CallValidationError(
          "INVALID_TIMESTAMP",
          `${field} must be ISO 8601 with a timezone offset (e.g. 2026-10-05T14:30:20+05:30) or epoch milliseconds.`,
        );
      }
      ms = Date.parse(text.replace(" ", "T").replace(/\s(?=Z|[+-])/i, ""));
    }
  } else {
    throw new CallValidationError("INVALID_TIMESTAMP", `${field} is required.`);
  }
  if (!Number.isFinite(ms) || ms < EARLIEST_CALL || ms > Date.now() + FUTURE_SKEW_MS) {
    throw new CallValidationError("INVALID_TIMESTAMP", `${field} is not a plausible call time.`);
  }
  return new Date(ms);
}

function sanitizeMetadata(raw: unknown): ValidatedCall["metadata"] {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new CallValidationError("INVALID_METADATA", "metadata must be a flat JSON object.");
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new CallValidationError("INVALID_METADATA", `metadata may have at most ${MAX_METADATA_KEYS} keys.`);
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    // No prototype-pollution vectors, no nesting.
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || key === "__proto__") {
      throw new CallValidationError("INVALID_METADATA", "metadata keys must be 1-40 chars of [A-Za-z0-9_.-].");
    }
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") out[key] = cleanText(value, 200);
    else throw new CallValidationError("INVALID_METADATA", "metadata values must be string, number, boolean or null.");
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_METADATA_BYTES) {
    throw new CallValidationError("INVALID_METADATA", `metadata exceeds ${MAX_METADATA_BYTES} bytes.`);
  }
  return Object.keys(out).length ? out : null;
}

export function parseCallType(raw: unknown): MobileCallType {
  if (typeof raw === "number" && ANDROID_TYPE_CODES[raw]) return ANDROID_TYPE_CODES[raw];
  if (typeof raw === "string") {
    const key = raw.trim().toLowerCase();
    if (/^\d$/.test(key) && ANDROID_TYPE_CODES[Number(key)]) return ANDROID_TYPE_CODES[Number(key)];
    if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  }
  throw new CallValidationError(
    "INVALID_CALL_TYPE",
    "call_type must be one of incoming, outgoing, missed, rejected, blocked, unknown.",
  );
}

/** Validates one call record from the phone. Throws CallValidationError. */
export function validateCall(raw: unknown, defaultSource = "api", fallbackStart?: Date): ValidatedCall {
  if (!isPlainObject(raw)) throw new CallValidationError("INVALID_FIELD", "Each call must be a JSON object.");

  if (typeof raw.phone_number !== "string" && typeof raw.phone_number !== "number") {
    throw new CallValidationError("INVALID_PHONE_NUMBER", "The supplied phone number is invalid.");
  }
  const phone = normalizeCallNumber(String(raw.phone_number));
  if (!phone) throw new CallValidationError("INVALID_PHONE_NUMBER", "The supplied phone number is invalid.");

  const callType = parseCallType(raw.call_type);
  // Realtime triggers (e.g. MacroDroid) can't always supply a call time. The
  // single-call endpoint may stamp the receipt time instead — flagged in
  // metadata so it's never mistaken for a device-reported time.
  const serverTime = fallbackStart !== undefined && (raw.started_at === undefined || raw.started_at === null || raw.started_at === "");
  const startedAt = serverTime ? fallbackStart : parseTimestamp(raw.started_at, "started_at");

  let endedAt: Date | null = null;
  if (raw.ended_at !== undefined && raw.ended_at !== null && raw.ended_at !== "") {
    endedAt = parseTimestamp(raw.ended_at, "ended_at");
    if (endedAt.getTime() < startedAt.getTime()) {
      throw new CallValidationError("INVALID_TIMESTAMP", "ended_at must not be before started_at.");
    }
  }

  let duration: number;
  if (raw.duration_seconds === undefined || raw.duration_seconds === null || raw.duration_seconds === "") {
    duration = endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : 0;
  } else {
    duration = typeof raw.duration_seconds === "string" ? Number(raw.duration_seconds) : (raw.duration_seconds as number);
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0 || duration > MAX_DURATION_SECONDS) {
      throw new CallValidationError(
        "INVALID_DURATION",
        `duration_seconds must be a whole number between 0 and ${MAX_DURATION_SECONDS}.`,
      );
    }
  }

  const simSlotRaw = raw.sim_slot;
  const simSlot =
    typeof simSlotRaw === "string" || typeof simSlotRaw === "number" ? cleanText(String(simSlotRaw), 8) || null : null;

  return {
    phoneNumberOriginal: phone.original,
    phoneNumberNormalized: phone.normalized,
    phoneLast10: phone.last10,
    phoneReliable: phone.reliable,
    contactName: optionalText(raw.contact_name, "contact_name", 120),
    callType,
    startedAt,
    endedAt,
    durationSeconds: duration,
    simSlot,
    simName: optionalText(raw.sim_name, "sim_name", 40),
    androidCallId: optionalText(raw.android_call_id, "android_call_id", 64),
    externalId: optionalText(raw.external_id, "external_id", 64),
    source: optionalText(raw.source, "source", 24)?.toLowerCase() ?? defaultSource,
    metadata: serverTime ? { ...(sanitizeMetadata(raw.metadata) ?? {}), time_source: "server" } : sanitizeMetadata(raw.metadata),
  };
}

/**
 * Idempotency key, unique per organization. A phone-supplied id (external_id
 * preferred, then android_call_id) is scoped to the device; otherwise a
 * fingerprint of the call's identifying facts is hashed. started_at is kept
 * at second precision so a retry carrying the same instant always collides.
 */
export function buildDedupKey(deviceId: string, call: ValidatedCall): string {
  const id = call.externalId ?? call.androidCallId;
  if (id) return `ext:${deviceId}:${id}`;
  const basis = [
    deviceId,
    call.phoneNumberNormalized,
    call.callType,
    Math.floor(call.startedAt.getTime() / 1000),
    call.durationSeconds,
  ].join("|");
  return `fp:${createHash("sha256").update(basis).digest("hex")}`;
}
