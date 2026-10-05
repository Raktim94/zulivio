import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildDedupKey,
  CallValidationError,
  MAX_BULK_CALLS,
  validateCall,
  type ValidatedCall,
} from "./mobile-call.validation";

export interface IngestDevice {
  id: string;
  organizationId: string;
  employeeId: string;
}

export type IngestItemStatus = "created" | "duplicate" | "rejected" | "failed";

export interface IngestItemResult {
  index: number;
  status: IngestItemStatus;
  code?: string;
  message?: string;
}

export interface IngestSummary {
  received: number;
  created: number;
  duplicates: number;
  rejected: number;
  failed: number;
  results: IngestItemResult[];
  lastExternalCallId: string | null;
}

// Two records from the same device with the same number and type whose start
// times differ by less than this are treated as one call. This is what stops
// a realtime MacroDroid event (start time read at hang-up) from duplicating
// the same call later re-read from the Android call log by a native app.
const FUZZY_WINDOW_MS = 5000;
const DB_CHUNK = 500;
const LEAD_MATCH_CHUNK = 100;

/**
 * The single write path for call history. Everything that creates calls —
 * the phone's realtime POST, its bulk sync and the admin file import —
 * funnels through ingest(), so validation, tenant scoping, de-duplication
 * and lead matching behave identically everywhere.
 *
 * `device` always comes from the authenticated token (or, for the admin
 * import, from a device row looked up with the actor's organizationId):
 * organization and employee are never read from the payload.
 */
@Injectable()
export class MobileCallsService {
  private readonly logger = new Logger(MobileCallsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(device: IngestDevice, rawCalls: unknown[], defaultSource: string, fallbackStart?: Date): Promise<IngestSummary> {
    const results: IngestItemResult[] = rawCalls.map((_, index) => ({ index, status: "created" }));

    const valid: { index: number; call: ValidatedCall; dedupKey: string }[] = [];
    rawCalls.forEach((raw, index) => {
      try {
        const call = validateCall(raw, defaultSource, fallbackStart);
        valid.push({ index, call, dedupKey: buildDedupKey(device.id, call) });
      } catch (err) {
        if (!(err instanceof CallValidationError)) throw err;
        results[index] = { index, status: "rejected", code: err.code, message: err.message };
      }
    });

    // 1. Duplicates inside this very batch.
    const seen = new Set<string>();
    let pending = valid.filter((item) => {
      if (seen.has(item.dedupKey)) {
        results[item.index] = { index: item.index, status: "duplicate" };
        return false;
      }
      seen.add(item.dedupKey);
      return true;
    });

    // 2. Exact-key duplicates already stored (tenant-scoped).
    const existingKeys = new Set<string>();
    for (let i = 0; i < pending.length; i += DB_CHUNK) {
      const rows = await this.prisma.mobileCall.findMany({
        where: {
          organizationId: device.organizationId,
          dedupKey: { in: pending.slice(i, i + DB_CHUNK).map((p) => p.dedupKey) },
        },
        select: { dedupKey: true },
      });
      rows.forEach((r) => existingKeys.add(r.dedupKey));
    }
    pending = pending.filter((item) => {
      if (existingKeys.has(item.dedupKey)) {
        results[item.index] = { index: item.index, status: "duplicate" };
        return false;
      }
      return true;
    });

    // 3. Near-identical records stored under a different key.
    if (pending.length > 0) {
      const times = pending.map((p) => p.call.startedAt.getTime());
      const candidates = await this.prisma.mobileCall.findMany({
        where: {
          organizationId: device.organizationId,
          deviceId: device.id,
          startedAt: {
            gte: new Date(Math.min(...times) - FUZZY_WINDOW_MS),
            lte: new Date(Math.max(...times) + FUZZY_WINDOW_MS),
          },
          phoneLast10: { in: [...new Set(pending.map((p) => p.call.phoneLast10))] },
        },
        select: { phoneNumberNormalized: true, callType: true, startedAt: true },
      });
      pending = pending.filter((item) => {
        const near = candidates.some(
          (c) =>
            c.phoneNumberNormalized === item.call.phoneNumberNormalized &&
            c.callType === item.call.callType &&
            Math.abs(c.startedAt.getTime() - item.call.startedAt.getTime()) < FUZZY_WINDOW_MS,
        );
        if (near) results[item.index] = { index: item.index, status: "duplicate" };
        return !near;
      });
    }

    // 4. Match to leads, then insert. createMany(skipDuplicates) backs the
    //    pre-checks above with the DB unique constraint, so two concurrent
    //    retries of the same call still yield exactly one row.
    const leadByLast10 = await this.matchLeads(
      device.organizationId,
      pending.filter((p) => p.call.phoneReliable).map((p) => p.call.phoneLast10),
    );

    const now = new Date();
    for (let i = 0; i < pending.length; i += DB_CHUNK) {
      const chunk = pending.slice(i, i + DB_CHUNK);
      try {
        const { count } = await this.prisma.mobileCall.createMany({
          data: chunk.map(({ call, dedupKey }) => ({
            organizationId: device.organizationId,
            deviceId: device.id,
            employeeId: device.employeeId,
            leadId: call.phoneReliable ? (leadByLast10.get(call.phoneLast10) ?? null) : null,
            phoneNumberOriginal: call.phoneNumberOriginal,
            phoneNumberNormalized: call.phoneNumberNormalized,
            phoneLast10: call.phoneLast10,
            contactName: call.contactName,
            callType: call.callType,
            startedAt: call.startedAt,
            endedAt: call.endedAt,
            durationSeconds: call.durationSeconds,
            simSlot: call.simSlot,
            simName: call.simName,
            androidCallId: call.androidCallId,
            externalId: call.externalId,
            dedupKey,
            source: call.source,
            metadata: call.metadata ?? undefined,
            syncedAt: now,
          })),
          skipDuplicates: true,
        });
        // Rows lost to a concurrent identical insert are duplicates, not errors.
        const lost = chunk.length - count;
        chunk.forEach((item, n) => {
          results[item.index] = { index: item.index, status: n < lost ? "duplicate" : "created" };
        });
      } catch (err) {
        // Never surface DB internals to the phone; log server-side only.
        this.logger.error(`Call insert failed for device ${device.id}: ${(err as Error).name}`);
        for (const item of chunk) {
          results[item.index] = {
            index: item.index,
            status: "failed",
            code: "INSERT_FAILED",
            message: "The record could not be stored. Retry later.",
          };
        }
      }
    }

    // Newest call that carried a device-side id, for incremental sync.
    let lastExternalCallId: string | null = null;
    let lastStart = -1;
    for (const item of valid) {
      const id = item.call.externalId ?? item.call.androidCallId;
      const status = results[item.index].status;
      if (id && (status === "created" || status === "duplicate") && item.call.startedAt.getTime() > lastStart) {
        lastStart = item.call.startedAt.getTime();
        lastExternalCallId = id;
      }
    }

    const count = (s: IngestItemStatus) => results.filter((r) => r.status === s).length;
    return {
      received: rawCalls.length,
      created: count("created"),
      duplicates: count("duplicate"),
      rejected: count("rejected"),
      failed: count("failed"),
      results,
      lastExternalCallId,
    };
  }

  /** last10 -> leadId for numbers matching exactly one lead (newest wins on ties). Org-scoped. */
  private async matchLeads(organizationId: string, last10s: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(last10s)];
    for (let i = 0; i < unique.length; i += LEAD_MATCH_CHUNK) {
      const slice = unique.slice(i, i + LEAD_MATCH_CHUNK);
      const leads = await this.prisma.lead.findMany({
        where: {
          organizationId,
          OR: slice.map((n) => ({ phone: { endsWith: n } })),
        },
        select: { id: true, phone: true },
        orderBy: { createdAt: "desc" },
      });
      for (const lead of leads) {
        const digits = (lead.phone ?? "").replace(/\D/g, "");
        const key = digits.length > 10 ? digits.slice(-10) : digits;
        if (slice.includes(key) && !out.has(key)) out.set(key, lead.id);
      }
    }
    return out;
  }

  async touchDevice(
    deviceId: string,
    data: { sync?: boolean; test?: boolean; lastExternalCallId?: string | null },
  ): Promise<void> {
    const now = new Date();
    const update: Prisma.MobileDeviceUpdateInput = { lastSeenAt: now };
    if (data.sync) update.lastSyncAt = now;
    if (data.test) update.lastTestAt = now;
    if (data.lastExternalCallId) update.lastExternalCallId = data.lastExternalCallId;
    // Best-effort: bookkeeping must never fail a request that already stored data.
    await this.prisma.mobileDevice.update({ where: { id: deviceId }, data: update }).catch(() => undefined);
  }

  static readonly MAX_BULK = MAX_BULK_CALLS;
}
