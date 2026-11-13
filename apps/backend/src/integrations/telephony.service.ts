import { BadRequestException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CallOutcome, LeadActivityType, type Prisma } from "@prisma/client";
import { FieldEncryptionService } from "../common/crypto/field-encryption.service";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { phoneLast10 } from "../common/phone.util";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { LeadActivityService } from "../leads/lead-activity.service";
import { mobileError } from "../mobile-calls/mobile-api-error.filter";
import { normalizeCallNumber } from "../mobile-calls/mobile-phone.util";
import { PrismaService } from "../prisma/prisma.service";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

export const SIGNATURE_TOLERANCE_SECONDS = 300;
const RECEIVER_LIMIT = new InMemoryRateLimiter(300, 60_000, "Too many events. Slow down.");
const BAD_SIGNATURE_LIMIT = new InMemoryRateLimiter(30, 60_000, "Too many invalid signatures.");

export type CanonicalEvent = "started" | "answered" | "completed" | "missed";
export interface NormalizedCall {
  providerCallId: string;
  eventType: CanonicalEvent;
  direction: "inbound" | "outbound" | "unknown";
  phone: string;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  agentEmail: string | null;
}

/** Where each fact lives in the provider's JSON (dot paths, e.g. "data.call.id"). */
export const DEFAULT_FIELDS: Record<string, string> = {
  providerCallId: "call_id", eventType: "event", direction: "direction", customerPhone: "from",
  customerPhoneInbound: "", customerPhoneOutbound: "", startedAt: "started_at", answeredAt: "answered_at", endedAt: "ended_at", duration: "duration", agentEmail: "agent_email",
};
export const DEFAULT_STATUS_MAP: Record<string, string> = {
  ringing: "started", started: "started", initiated: "started", answered: "answered", connected: "answered",
  completed: "completed", ended: "completed", hangup: "completed", missed: "missed", "no-answer": "missed", no_answer: "missed", abandoned: "missed",
};
const FIELD_KEYS = Object.keys(DEFAULT_FIELDS);
const CANONICAL = new Set(["started", "answered", "completed", "missed"]);

export interface ProviderSettings { auth: "hmac" | "token"; fields: Record<string, string> }

function pick(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
const asText = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);
function asDate(v: unknown): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (v === "") return null;
  const text = String(v);
  const n = /^\d{9,13}$/.test(text) ? (Number(text) < 1e11 ? Number(text) * 1000 : Number(text)) : typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(text);
  return Number.isFinite(n) ? new Date(n) : null;
}

/** Pure mapping from a provider payload to the canonical event. Throws BadRequest with a reason when it can't. */
export function normalizeProviderPayload(payload: unknown, settings: ProviderSettings, statusMap: Record<string, string>): NormalizedCall {
  const f = { ...DEFAULT_FIELDS, ...settings.fields };
  const callId = asText(pick(payload, f.providerCallId));
  if (!callId) throw new BadRequestException(`Could not find a call id at "${f.providerCallId}".`);
  const rawEvent = asText(pick(payload, f.eventType));
  if (!rawEvent) throw new BadRequestException(`Could not find the event/status at "${f.eventType}".`);
  const eventType = CANONICAL.has(rawEvent.toLowerCase()) ? (rawEvent.toLowerCase() as CanonicalEvent) : (statusMap[rawEvent.toLowerCase()] as CanonicalEvent | undefined);
  if (!eventType || !CANONICAL.has(eventType)) throw new BadRequestException(`Event "${rawEvent}" is not mapped. Add it to the event mapping.`);

  const dirRaw = (asText(pick(payload, f.direction)) ?? "").toLowerCase();
  const direction = /^(in|inbound|incoming)$/.test(dirRaw) ? "inbound" : /^(out|outbound|outgoing)$/.test(dirRaw) ? "outbound" : "unknown";
  const phonePath = direction === "outbound" && f.customerPhoneOutbound ? f.customerPhoneOutbound : direction === "inbound" && f.customerPhoneInbound ? f.customerPhoneInbound : f.customerPhone;
  const phone = asText(pick(payload, phonePath));
  if (!phone || !normalizeCallNumber(phone)) throw new BadRequestException(`Could not find a valid customer phone number at "${phonePath}".`);

  const durRaw = pick(payload, f.duration);
  const duration = durRaw === undefined || durRaw === null || durRaw === "" ? null : Number(durRaw);
  if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 86_400)) throw new BadRequestException("Duration must be a whole number of seconds (0-86400).");
  return {
    providerCallId: callId.slice(0, 100), eventType, direction, phone,
    startedAt: asDate(pick(payload, f.startedAt)), answeredAt: asDate(pick(payload, f.answeredAt)), endedAt: asDate(pick(payload, f.endedAt)),
    durationSeconds: duration, agentEmail: asText(pick(payload, f.agentEmail))?.toLowerCase() ?? null,
  };
}

export function verifyHmac(secret: string, header: string | undefined, rawBody: Buffer, nowMs = Date.now()): "ok" | "missing" | "stale" | "bad" {
  if (!header) return "missing";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return "bad";
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return "stale";
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  let given: Buffer;
  try { given = Buffer.from(parts.v1, "hex"); } catch { return "bad"; }
  return given.length === expected.length && timingSafeEqual(given, expected) ? "ok" : "bad";
}

@Injectable()
export class TelephonyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
    private readonly activity: LeadActivityService,
    private readonly hooks: WebhookDispatcher,
  ) {}

  private audit(actor: AuthenticatedEmployee, action: string, id: string, metadata: Record<string, string | number | boolean | null> = {}) {
    return this.prisma.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action, targetType: "TelephonyProvider", targetId: id, metadata } });
  }

  private settings(p: { fieldMap: Prisma.JsonValue }): ProviderSettings {
    const m = (p.fieldMap ?? {}) as { auth?: string; fields?: Record<string, string> };
    return { auth: m.auth === "token" ? "token" : "hmac", fields: m.fields ?? {} };
  }

  private cleanFields(fields: Record<string, string> | undefined) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (!FIELD_KEYS.includes(k)) throw new BadRequestException(`Unknown mapping field "${k}".`);
      if (typeof v !== "string" || v.length > 120 || !/^[A-Za-z0-9_.\-[\]]*$/.test(v)) throw new BadRequestException(`Mapping for "${k}" must be a simple dot path such as data.call.id.`);
      out[k] = v;
    }
    return out;
  }

  private cleanStatusMap(map: Record<string, string> | undefined) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map ?? {})) {
      if (!CANONICAL.has(v)) throw new BadRequestException(`"${k}" must map to one of started, answered, completed, missed.`);
      out[k.toLowerCase().slice(0, 60)] = v;
    }
    return out;
  }

  private view(p: { id: string; kind: string; name: string; enabled: boolean; secretLastFour: string; fieldMap: Prisma.JsonValue; statusMap: Prisma.JsonValue; eventsReceived: number; eventsRejected: number; lastEventAt: Date | null; lastErrorAt: Date | null; lastError: string | null; lastTestAt: Date | null; createdAt: Date }) {
    const s = this.settings(p);
    const base = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
    return {
      id: p.id, kind: p.kind, name: p.name, enabled: p.enabled, auth: s.auth, fields: { ...DEFAULT_FIELDS, ...s.fields }, statusMap: { ...DEFAULT_STATUS_MAP, ...((p.statusMap ?? {}) as Record<string, string>) },
      secretPreview: `tpsec_••••${p.secretLastFour}`, eventUrlPath: `/api/v1/integrations/telephony/${p.id}/events`, eventUrl: base ? `${base}/api/v1/integrations/telephony/${p.id}/events` : null,
      delivery: { eventsReceived: p.eventsReceived, eventsRejected: p.eventsRejected, lastEventAt: p.lastEventAt, lastErrorAt: p.lastErrorAt, lastError: p.lastError, lastTestAt: p.lastTestAt },
      createdAt: p.createdAt,
    };
  }

  async list(actor: AuthenticatedEmployee) {
    const rows = await this.prisma.telephonyProvider.findMany({ where: { organizationId: actor.organizationId }, orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.view(r));
  }

  async create(actor: AuthenticatedEmployee, dto: { name: string; auth?: "hmac" | "token"; fields?: Record<string, string>; statusMap?: Record<string, string> }) {
    const secret = "tpsec_" + randomBytes(32).toString("base64url");
    const row = await this.prisma.telephonyProvider.create({
      data: {
        organizationId: actor.organizationId, kind: "GENERIC_WEBHOOK", name: dto.name.trim(), createdById: actor.id, secretEnc: this.crypto.encrypt(secret), secretLastFour: secret.slice(-4),
        fieldMap: { auth: dto.auth ?? "hmac", fields: this.cleanFields(dto.fields) }, statusMap: this.cleanStatusMap(dto.statusMap),
      },
    });
    await this.audit(actor, "telephony_provider.created", row.id, { name: row.name });
    return { ...this.view(row), secret }; // shown once
  }

  private async load(actor: AuthenticatedEmployee, id: string) {
    const row = await this.prisma.telephonyProvider.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!row) throw new NotFoundException("Provider not found");
    return row;
  }

  async update(actor: AuthenticatedEmployee, id: string, dto: { name?: string; enabled?: boolean; auth?: "hmac" | "token"; fields?: Record<string, string>; statusMap?: Record<string, string> }) {
    const row = await this.load(actor, id);
    const cur = this.settings(row);
    const updated = await this.prisma.telephonyProvider.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.auth !== undefined || dto.fields !== undefined ? { fieldMap: { auth: dto.auth ?? cur.auth, fields: dto.fields !== undefined ? this.cleanFields(dto.fields) : cur.fields } } : {}),
        ...(dto.statusMap !== undefined ? { statusMap: this.cleanStatusMap(dto.statusMap) } : {}),
      },
    });
    await this.audit(actor, "telephony_provider.updated", id, { name: updated.name, enabled: updated.enabled });
    return this.view(updated);
  }

  async rotateSecret(actor: AuthenticatedEmployee, id: string) {
    await this.load(actor, id);
    const secret = "tpsec_" + randomBytes(32).toString("base64url");
    const updated = await this.prisma.telephonyProvider.update({ where: { id }, data: { secretEnc: this.crypto.encrypt(secret), secretLastFour: secret.slice(-4) } });
    await this.audit(actor, "telephony_provider.secret_rotated", id, { name: updated.name });
    return { ...this.view(updated), secret };
  }

  async remove(actor: AuthenticatedEmployee, id: string) {
    const row = await this.load(actor, id);
    await this.prisma.telephonyProvider.delete({ where: { id } });
    await this.audit(actor, "telephony_provider.deleted", id, { name: row.name });
    return { ok: true };
  }

  /** Dry run: shows what the mapping would extract. Stores no call and sends nothing. */
  async test(actor: AuthenticatedEmployee, id: string, payload?: Record<string, unknown>) {
    const row = await this.load(actor, id);
    const s = this.settings(row);
    const f = { ...DEFAULT_FIELDS, ...s.fields };
    const sample = payload ?? this.samplePayload(f);
    let result: { ok: true; normalized: NormalizedCall } | { ok: false; error: string };
    try {
      result = { ok: true, normalized: normalizeProviderPayload(sample, s, { ...DEFAULT_STATUS_MAP, ...((row.statusMap ?? {}) as Record<string, string>) }) };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
    await this.prisma.telephonyProvider.update({ where: { id }, data: { lastTestAt: new Date() } });
    await this.audit(actor, "telephony_provider.tested", id, { ok: result.ok });
    return { ...result, sample: payload ? undefined : sample, signing: { header: "X-Zulivio-Signature", format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` with the provider secret>", toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS, alternative: s.auth === "token" ? "Send the secret in the X-Zulivio-Token header." : null } };
  }

  private samplePayload(f: Record<string, string>) {
    const set = (o: Record<string, unknown>, path: string, value: unknown) => {
      if (!path) return;
      const keys = path.split(".");
      let cur = o;
      keys.slice(0, -1).forEach((k) => { cur = (cur[k] ??= {}) as Record<string, unknown>; });
      cur[keys[keys.length - 1]] = value;
    };
    const o: Record<string, unknown> = {};
    set(o, f.providerCallId, "sample-call-1"); set(o, f.eventType, "completed"); set(o, f.direction, "inbound"); set(o, f.customerPhone, "+919876543210");
    set(o, f.startedAt, new Date(Date.now() - 120_000).toISOString()); set(o, f.endedAt, new Date().toISOString()); set(o, f.duration, 118);
    return o;
  }

  async events(actor: AuthenticatedEmployee, id: string, limit = 25) {
    await this.load(actor, id);
    const rows = await this.prisma.providerCallEvent.findMany({ where: { providerId: id, organizationId: actor.organizationId }, orderBy: { receivedAt: "desc" }, take: Math.min(limit, 100) });
    return rows.map((r) => ({ id: r.id, providerCallId: r.providerCallId, eventType: r.eventType, direction: r.direction, phone: r.phoneNormalized, durationSeconds: r.durationSeconds, leadId: r.leadId, receivedAt: r.receivedAt }));
  }

  // ---------------- public receiver ----------------

  /**
   * Authenticates (HMAC over the raw body, or a static token if the provider can't sign), then ingests. The provider id
   * in the URL decides the organization — nothing in the body can.
   */
  async receive(providerId: string, rawBody: Buffer | undefined, body: unknown, headers: Record<string, string | string[] | undefined>, ip: string) {
    RECEIVER_LIMIT.assert(providerId);
    const fail = (status: HttpStatus, code: string, message: string) => mobileError(status, code, message);
    const provider = /^[0-9a-f-]{36}$/i.test(providerId) ? await this.prisma.telephonyProvider.findUnique({ where: { id: providerId } }) : null;
    // Unknown id and wrong secret look identical to a caller.
    if (!provider || !provider.enabled) {
      BAD_SIGNATURE_LIMIT.assert(`${ip}`);
      throw fail(HttpStatus.UNAUTHORIZED, "INVALID_SIGNATURE", "Invalid signature.");
    }
    const settings = this.settings(provider);
    const secret = this.crypto.decrypt(provider.secretEnc);
    const header = (n: string) => (Array.isArray(headers[n]) ? (headers[n])[0] : (headers[n]));
    let verdict: "ok" | "missing" | "stale" | "bad";
    if (settings.auth === "token") {
      const given = header("x-zulivio-token") ?? "";
      const givenBuf = Buffer.from(given);
      const secretBuf = Buffer.from(secret);
      verdict = givenBuf.length === secretBuf.length && timingSafeEqual(givenBuf, secretBuf) ? "ok" : given ? "bad" : "missing";
    } else {
      if (!rawBody) throw fail(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Body must be JSON.");
      verdict = verifyHmac(secret, header("x-zulivio-signature"), rawBody);
    }
    if (verdict !== "ok") {
      BAD_SIGNATURE_LIMIT.assert(`${ip}`);
      await this.prisma.telephonyProvider.update({ where: { id: provider.id }, data: { eventsRejected: { increment: 1 }, lastErrorAt: new Date(), lastError: verdict === "stale" ? "Signature timestamp outside the allowed window" : "Invalid or missing signature" } });
      throw fail(HttpStatus.UNAUTHORIZED, verdict === "stale" ? "STALE_SIGNATURE" : "INVALID_SIGNATURE", verdict === "stale" ? "Signature timestamp is outside the allowed window." : "Invalid signature.");
    }

    let normalized: NormalizedCall;
    try {
      normalized = normalizeProviderPayload(body, settings, { ...DEFAULT_STATUS_MAP, ...((provider.statusMap ?? {}) as Record<string, string>) });
    } catch (e) {
      await this.prisma.telephonyProvider.update({ where: { id: provider.id }, data: { eventsRejected: { increment: 1 }, lastErrorAt: new Date(), lastError: (e as Error).message.slice(0, 200) } });
      throw fail(HttpStatus.UNPROCESSABLE_ENTITY, "MAPPING_FAILED", (e as Error).message);
    }
    const result = await this.ingest(provider.organizationId, `provider:${provider.id}`, provider.id, provider.name, provider.createdById, normalized);
    await this.prisma.telephonyProvider.update({ where: { id: provider.id }, data: { eventsReceived: { increment: result.duplicate ? 0 : 1 }, lastEventAt: new Date(), lastError: null } });
    return { success: true, duplicate: result.duplicate, event_id: result.id };
  }

  /** Shared by the provider receiver and POST /ext/calls. Idempotent per (source, call id, event type). */
  async ingest(organizationId: string, source: string, providerId: string | null, sourceName: string, fallbackActorId: string, n: NormalizedCall) {
    const phone = normalizeCallNumber(n.phone)!;
    const dedupKey = `${source}:${n.providerCallId}:${n.eventType}`;
    const existing = await this.prisma.providerCallEvent.findUnique({ where: { organizationId_dedupKey: { organizationId, dedupKey } } });
    if (existing) return { duplicate: true, id: existing.id };

    const employee = n.agentEmail ? await this.prisma.employee.findFirst({ where: { organizationId, email: n.agentEmail, employmentStatus: "ACTIVE" }, select: { id: true } }) : null;
    const leads = phone.last10.length === 10
      ? await this.prisma.lead.findMany({ where: { organizationId, phone: { endsWith: phone.last10 } }, select: { id: true, phone: true, ownerId: true }, orderBy: { updatedAt: "desc" }, take: 5 })
      : [];
    const matching = leads.filter((l) => phoneLast10(l.phone) === phone.last10);
    const lead = matching.find((l) => employee && l.ownerId === employee.id) ?? matching[0] ?? null;

    let row;
    try {
      row = await this.prisma.providerCallEvent.create({
        data: {
          organizationId, providerId, source, providerCallId: n.providerCallId, dedupKey, eventType: n.eventType, direction: n.direction, phoneOriginal: phone.original, phoneNormalized: phone.normalized, phoneLast10: phone.last10,
          startedAt: n.startedAt, answeredAt: n.answeredAt, endedAt: n.endedAt, durationSeconds: n.durationSeconds, employeeId: employee?.id ?? null, leadId: lead?.id ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const again = await this.prisma.providerCallEvent.findUniqueOrThrow({ where: { organizationId_dedupKey: { organizationId, dedupKey } } });
        return { duplicate: true, id: again.id }; // lost a race with a provider retry
      }
      throw e;
    }

    // Only terminal events belong on a lead's timeline; "started"/"answered" are kept as events but are not a result.
    if (lead && (n.eventType === "completed" || n.eventType === "missed")) {
      const connected = n.eventType === "completed" && (n.durationSeconds ?? 0) > 0;
      await this.activity.record({
        organizationId, leadId: lead.id, actorId: employee?.id ?? fallbackActorId, type: LeadActivityType.CALL,
        body: `${n.direction === "inbound" ? "Inbound" : n.direction === "outbound" ? "Outbound" : "Call"} call ${n.eventType === "missed" ? "missed" : "completed"} (from ${sourceName})`,
        callOutcome: connected ? CallOutcome.CONNECTED : CallOutcome.NOT_CONNECTED, callDurationSeconds: n.durationSeconds,
        metadata: { source: "provider_imported", provider: sourceName.slice(0, 60), providerCallId: n.providerCallId, direction: n.direction, event: n.eventType },
      });
      await this.prisma.lead.update({ where: { id: lead.id }, data: { lastContactedAt: n.endedAt ?? new Date() } });
    }
    await this.hooks.emit(organizationId, "call.recorded", {
      id: row.id, source: providerId ? "provider_imported" : "api", eventType: n.eventType, direction: n.direction, phone: phone.normalized, durationSeconds: n.durationSeconds,
      startedAt: n.startedAt?.toISOString() ?? null, endedAt: n.endedAt?.toISOString() ?? null, leadId: lead?.id ?? null, employeeId: employee?.id ?? null, providerCallId: n.providerCallId,
    });
    return { duplicate: false, id: row.id };
  }
}
