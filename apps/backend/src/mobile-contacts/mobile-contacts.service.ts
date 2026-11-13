import { HttpStatus, Injectable } from "@nestjs/common";
import { WebhookDispatcher } from "../integrations/webhook-dispatcher.service";
import { createHash } from "node:crypto";
import { MobileContactStatus, type Prisma } from "@prisma/client";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { phoneLast10 } from "../common/phone.util";
import { LeadAccessService } from "../leads/lead-access.service";
import { LeadsService } from "../leads/leads.service";
import { mobileError } from "../mobile-calls/mobile-api-error.filter";
import type { AuthenticatedDevice } from "../mobile-calls/mobile-device.guard";
import { normalizeCallNumber } from "../mobile-calls/mobile-phone.util";
import { PrismaService } from "../prisma/prisma.service";
import type { ContactImportItemDto, ContactInputDto, ShareableField } from "./dto";

export type PreviewState =
  | "NEW"
  | "UNCHANGED"
  | "CHANGED"
  | "DUPLICATE_LEAD"
  | "DUPLICATE_HIDDEN"
  | "DUPLICATE_CONTACT"
  | "DUPLICATE_IN_BATCH"
  | "NO_PHONE";

interface Prepared {
  input: ContactInputDto;
  sourceKeyHash: string;
  phones: { original: string; normalized: string; last10: string }[];
  last10s: string[];
  emails: string[];
  company: string | null;
  contentHash: string;
}

export function sourceKeyHash(deviceId: string, rawId: string): string {
  return createHash("sha256").update(`${deviceId}:${rawId}`).digest("hex");
}

export function contentHashOf(p: { displayName: string; company: string | null; emails: string[]; normalizedPhones: string[] }): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        p.displayName.trim(),
        p.company ?? null,
        [...p.emails].sort(),
        [...p.normalizedPhones].sort(),
      ]),
    )
    .digest("hex");
}

@Injectable()
export class MobileContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadAccess: LeadAccessService,
    private readonly leads: LeadsService,
    private readonly hooks: WebhookDispatcher,
  ) {}

  /** The authenticated actor is rebuilt from the database row the device token resolves to, never from the request. */
  async actorFor(device: AuthenticatedDevice): Promise<AuthenticatedEmployee> {
    const e = await this.prisma.employee.findUniqueOrThrow({ where: { id: device.employeeId } });
    return {
      id: e.id,
      organizationId: e.organizationId,
      role: e.role,
      fullName: e.fullName,
      email: e.email,
      employmentStatus: e.employmentStatus,
      mustChangePassword: e.mustChangePassword,
    };
  }

  private prepare(device: AuthenticatedDevice, input: ContactInputDto, fields: ShareableField[]): Prepared {
    const phones = [] as Prepared["phones"];
    const seen = new Set<string>();
    for (const raw of input.phones) {
      const n = normalizeCallNumber(raw);
      if (!n || seen.has(n.normalized)) continue;
      seen.add(n.normalized);
      phones.push({ original: n.original, normalized: n.normalized, last10: n.last10 });
    }
    const company = fields.includes("company") && input.company?.trim() ? input.company.trim().slice(0, 200) : null;
    const emails = fields.includes("emails")
      ? [...new Set((input.emails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)))]
      : [];
    const displayName = input.displayName.trim() || phones[0]?.original || "Unnamed contact";
    return {
      input: { ...input, displayName },
      sourceKeyHash: sourceKeyHash(device.id, input.sourceId),
      phones,
      // Only full-length numbers are reliable duplicate keys.
      last10s: [...new Set(phones.filter((p) => p.last10.length === 10).map((p) => p.last10))],
      emails,
      company,
      contentHash: contentHashOf({ displayName, company, emails, normalizedPhones: phones.map((p) => p.normalized) }),
    };
  }

  /** Leads in the org whose phone ends with any of these 10-digit keys, split into visible and hidden to the actor. */
  private async matchLeads(actor: AuthenticatedEmployee, last10s: string[]) {
    const visible = new Map<string, { id: string; fullName: string }>();
    const hidden = new Set<string>();
    if (last10s.length === 0) return { visible, hidden };
    const scope = await this.leadAccess.leadScopeWhere(actor);
    for (let i = 0; i < last10s.length; i += 100) {
      const chunk = last10s.slice(i, i + 100);
      const found = await this.prisma.lead.findMany({
        where: { organizationId: actor.organizationId, OR: chunk.map((l) => ({ phone: { endsWith: l } })) },
        select: { id: true, fullName: true, phone: true, ownerId: true, createdById: true },
      });
      if (found.length === 0) continue;
      const visibleIds = new Set(
        (await this.prisma.lead.findMany({ where: { AND: [scope, { id: { in: found.map((f) => f.id) } }] }, select: { id: true } })).map((l) => l.id),
      );
      for (const lead of found) {
        const key = phoneLast10(lead.phone);
        if (!key) continue;
        if (visibleIds.has(lead.id)) visible.set(key, { id: lead.id, fullName: lead.fullName });
        else hidden.add(key);
      }
    }
    return { visible, hidden };
  }

  async preview(device: AuthenticatedDevice, contacts: ContactInputDto[], fields: ShareableField[]) {
    const actor = await this.actorFor(device);
    const prepared = contacts.map((c) => this.prepare(device, c, fields));
    const { visible, hidden } = await this.matchLeads(actor, prepared.flatMap((p) => p.last10s));

    const existing = await this.prisma.mobileContact.findMany({
      where: { organizationId: device.organizationId, deviceId: device.id, sourceKeyHash: { in: prepared.map((p) => p.sourceKeyHash) } },
      select: { sourceKeyHash: true, contentHash: true, status: true },
    });
    const existingByKey = new Map(existing.map((e) => [e.sourceKeyHash, e]));
    const otherContacts = await this.prisma.mobileContact.findMany({
      where: { organizationId: device.organizationId, employeeId: device.employeeId, phoneLast10: { hasSome: prepared.flatMap((p) => p.last10s) } },
      select: { id: true, sourceKeyHash: true, phoneLast10: true, deviceId: true },
    });

    const firstSeen = new Map<string, number>();
    const results = prepared.map((p, index) => {
      const base = {
        index,
        sourceId: p.input.sourceId,
        displayName: p.input.displayName,
        phones: p.phones.map((x) => x.normalized),
        normalizationUnreliable: p.phones.some((x) => x.last10.length < 10),
      };
      if (p.phones.length === 0) return { ...base, state: "NO_PHONE" as PreviewState };

      const prior = existingByKey.get(p.sourceKeyHash);
      if (prior) {
        return { ...base, state: (prior.contentHash === p.contentHash ? "UNCHANGED" : "CHANGED") as PreviewState, previousStatus: prior.status };
      }
      for (const key of p.last10s) {
        if (firstSeen.has(key)) return { ...base, state: "DUPLICATE_IN_BATCH" as PreviewState, duplicateOfIndex: firstSeen.get(key) };
      }
      p.last10s.forEach((k) => firstSeen.set(k, index));
      for (const key of p.last10s) {
        const lead = visible.get(key);
        if (lead) return { ...base, state: "DUPLICATE_LEAD" as PreviewState, matchLeadId: lead.id, matchLeadName: lead.fullName };
      }
      // Exists in the org but belongs to someone outside this user's scope:
      // say so without leaking who or what.
      if (p.last10s.some((k) => hidden.has(k))) return { ...base, state: "DUPLICATE_HIDDEN" as PreviewState };
      const dupContact = otherContacts.find((c) => c.phoneLast10.some((k) => p.last10s.includes(k)) && c.sourceKeyHash !== p.sourceKeyHash);
      if (dupContact) return { ...base, state: "DUPLICATE_CONTACT" as PreviewState, matchContactId: dupContact.id };
      return { ...base, state: "NEW" as PreviewState };
    });

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.state] = (counts[r.state] ?? 0) + 1;
    return { results, counts };
  }

  async import(device: AuthenticatedDevice, items: ContactImportItemDto[], fields: ShareableField[]) {
    const actor = await this.actorFor(device);
    const out: { sourceId: string; status: string; code?: string; message?: string; leadId?: string }[] = [];
    let created = 0;
    let linked = 0;
    let skipped = 0;
    let unchanged = 0;
    let rejected = 0;

    for (const item of items) {
      const p = this.prepare(device, item, fields);
      try {
        const status =
          item.decision === "SKIP" ? MobileContactStatus.SKIPPED : item.decision === "LINK" ? MobileContactStatus.LINKED : MobileContactStatus.IMPORTED;
        const existing = await this.prisma.mobileContact.findUnique({
          where: { organizationId_deviceId_sourceKeyHash: { organizationId: device.organizationId, deviceId: device.id, sourceKeyHash: p.sourceKeyHash } },
        });

        // Idempotency / "do not repeatedly upload unchanged contacts": same
        // content and an already-settled decision is a no-op.
        if (existing && existing.contentHash === p.contentHash && existing.status === status && (status === MobileContactStatus.SKIPPED || existing.leadId)) {
          unchanged++;
          out.push({ sourceId: item.sourceId, status: "unchanged", leadId: existing.leadId ?? undefined });
          continue;
        }

        if (item.decision === "SKIP") {
          // Minimal footprint for skipped contacts: remember the decision, not the person.
          await this.prisma.mobileContact.upsert({
            where: { organizationId_deviceId_sourceKeyHash: { organizationId: device.organizationId, deviceId: device.id, sourceKeyHash: p.sourceKeyHash } },
            create: { organizationId: device.organizationId, employeeId: device.employeeId, deviceId: device.id, sourceKeyHash: p.sourceKeyHash, displayName: "(skipped)", contentHash: p.contentHash, status },
            update: { displayName: "(skipped)", company: null, emails: [], phones: [], phoneLast10: [], contentHash: p.contentHash, status, leadId: null, lastSyncedAt: new Date() },
          });
          skipped++;
          out.push({ sourceId: item.sourceId, status: "skipped" });
          continue;
        }

        if (p.phones.length === 0) {
          rejected++;
          out.push({ sourceId: item.sourceId, status: "rejected", code: "NO_VALID_PHONE", message: "Contact has no usable phone number." });
          continue;
        }

        let leadId: string | null = existing?.leadId ?? null;
        if (item.decision === "LINK") {
          if (!item.linkLeadId) {
            rejected++;
            out.push({ sourceId: item.sourceId, status: "rejected", code: "LINK_TARGET_REQUIRED", message: "linkLeadId is required for LINK." });
            continue;
          }
          const lead = await this.leadAccess.findScopedLead(actor, item.linkLeadId).catch(() => null);
          if (!lead) {
            rejected++;
            out.push({ sourceId: item.sourceId, status: "rejected", code: "LEAD_NOT_ACCESSIBLE", message: "That lead does not exist or you cannot access it." });
            continue;
          }
          leadId = lead.id;
        } else if (!leadId) {
          const { visible, hidden } = await this.matchLeads(actor, p.last10s);
          if (p.last10s.some((k) => visible.has(k) || hidden.has(k))) {
            rejected++;
            out.push({ sourceId: item.sourceId, status: "rejected", code: "DUPLICATE_LEAD", message: "A lead with this number already exists. Link it instead." });
            continue;
          }
        }

        const data = {
          displayName: p.input.displayName,
          company: p.company,
          emails: p.emails,
          phones: p.phones as unknown as Prisma.InputJsonValue,
          phoneLast10: p.last10s,
          contentHash: p.contentHash,
          status,
          lastSyncedAt: new Date(),
        };
        // Reserve the contact row first so a retry after a crash finds it and
        // does not create a second lead.
        const row = await this.prisma.mobileContact.upsert({
          where: { organizationId_deviceId_sourceKeyHash: { organizationId: device.organizationId, deviceId: device.id, sourceKeyHash: p.sourceKeyHash } },
          create: { organizationId: device.organizationId, employeeId: device.employeeId, deviceId: device.id, sourceKeyHash: p.sourceKeyHash, ...data, leadId },
          update: { ...data, leadId },
        });

        if (item.decision === "IMPORT" && !row.leadId) {
          const lead = await this.leads.create(actor, {
            fullName: p.input.displayName,
            phone: p.phones[0].normalized,
            email: p.emails[0],
            company: p.company ?? undefined,
            source: "Phone contacts",
            ownerId: actor.id,
          });
          await this.prisma.mobileContact.update({ where: { id: row.id }, data: { leadId: lead.id } });
          leadId = lead.id;
          created++;
        } else if (item.decision === "LINK") {
          linked++;
        }
        out.push({ sourceId: item.sourceId, status: item.decision === "LINK" ? "linked" : existing ? "updated" : "created", leadId: leadId ?? undefined });
        // Only identifiers and the decision leave in the event; the contact's details are already on the lead.
        void this.hooks.emit(device.organizationId, existing ? "contact.updated" : "contact.created", { contactId: row.id, leadId: leadId ?? null, employeeId: device.employeeId, decision: item.decision });
      } catch (err) {
        if (err instanceof Error && "getStatus" in err) throw err;
        rejected++;
        out.push({ sourceId: item.sourceId, status: "failed", code: "INTERNAL_ERROR", message: "Could not store this contact; retry later." });
      }
    }

    await this.prisma.mobileDevice.update({ where: { id: device.id }, data: { lastSyncAt: new Date(), lastSeenAt: new Date() } });
    await this.prisma.auditEvent
      .create({
        data: {
          organizationId: device.organizationId,
          actorId: device.employeeId,
          action: "mobile.contacts_import",
          targetType: "MobileDevice",
          targetId: device.id,
          metadata: { received: items.length, leadsCreated: created, linked, skipped, unchanged, rejected, fields },
        },
      })
      .catch(() => undefined);
    return { received: items.length, created, linked, skipped, unchanged, rejected, results: out };
  }

  async list(device: AuthenticatedDevice, q: string | undefined, cursor: string | undefined, limit = 50) {
    const where: Prisma.MobileContactWhereInput = {
      organizationId: device.organizationId,
      employeeId: device.employeeId,
      status: { not: MobileContactStatus.SKIPPED },
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              ...(q.replace(/\D/g, "").length >= 3 ? [{ phoneLast10: { hasSome: [q.replace(/\D/g, "").slice(-10)] } }] : []),
            ],
          }
        : {}),
    };
    const rows = await this.prisma.mobileContact.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, displayName: true, company: true, emails: true, phones: true, status: true, leadId: true, lastSyncedAt: true },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async summary(device: AuthenticatedDevice) {
    const groups = await this.prisma.mobileContact.groupBy({
      by: ["status"],
      where: { organizationId: device.organizationId, employeeId: device.employeeId },
      _count: true,
    });
    const last = await this.prisma.mobileContact.aggregate({
      where: { organizationId: device.organizationId, employeeId: device.employeeId },
      _max: { lastSyncedAt: true },
    });
    return {
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
      lastSyncedAt: last._max.lastSyncedAt,
    };
  }

  /** "Delete imported contact data". Leads already created from contacts remain ordinary CRM records (documented). */
  async deleteAll(device: AuthenticatedDevice, scope: "device" | "employee") {
    const { count } = await this.prisma.mobileContact.deleteMany({
      where: { organizationId: device.organizationId, ...(scope === "device" ? { deviceId: device.id } : { employeeId: device.employeeId }) },
    });
    await this.prisma.auditEvent
      .create({ data: { organizationId: device.organizationId, actorId: device.employeeId, action: "mobile.contacts_deleted", targetType: "MobileDevice", targetId: device.id, metadata: { count, scope } } })
      .catch(() => undefined);
    return { ok: true, deleted: count };
  }

  async deleteOne(device: AuthenticatedDevice, id: string) {
    const { count } = await this.prisma.mobileContact.deleteMany({
      where: { id, organizationId: device.organizationId, employeeId: device.employeeId },
    });
    if (count === 0) throw mobileError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Contact not found.");
    return { ok: true };
  }

  /** Daily sweep for organizations that set contactRetentionDays. */
  async purgeExpired(): Promise<number> {
    const orgs = await this.prisma.organization.findMany({ where: { contactRetentionDays: { not: null } }, select: { id: true, contactRetentionDays: true } });
    let total = 0;
    for (const org of orgs) {
      const cutoff = new Date(Date.now() - (org.contactRetentionDays as number) * 86_400_000);
      const { count } = await this.prisma.mobileContact.deleteMany({ where: { organizationId: org.id, lastSyncedAt: { lt: cutoff } } });
      if (count > 0) {
        total += count;
        await this.prisma.auditEvent.create({
          data: { organizationId: org.id, action: "mobile_contacts.retention_purge", targetType: "Organization", targetId: org.id, metadata: { count, retentionDays: org.contactRetentionDays } },
        });
      }
    }
    return total;
  }
}
