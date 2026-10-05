import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MobileCallType, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { EmployeeScopeService } from "../common/scope.service";
import { LeadAccessService } from "../leads/lead-access.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { normalizeCallNumber } from "./mobile-phone.util";
import { cleanText } from "./mobile-call.validation";
import { LeadActivityType } from "@prisma/client";

export interface CallFilters {
  employeeId?: string;
  deviceId?: string;
  phoneNumber?: string;
  callType?: string;
  from?: Date;
  to?: Date;
  leadId?: string;
  unassigned?: boolean;
  minDuration?: number;
  maxDuration?: number;
  source?: string;
  q?: string;
  page: number;
  limit: number;
}

const listSelect = {
  id: true,
  phoneNumberOriginal: true,
  phoneNumberNormalized: true,
  contactName: true,
  callType: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  simSlot: true,
  simName: true,
  source: true,
  employee: { select: { id: true, fullName: true } },
  device: { select: { id: true, name: true, deviceKey: true } },
  lead: { select: { id: true, fullName: true } },
} satisfies Prisma.MobileCallSelect;

type ListRow = Prisma.MobileCallGetPayload<{ select: typeof listSelect }>;

function present(row: ListRow) {
  return {
    id: row.id,
    phoneNumber: row.phoneNumberOriginal,
    phoneNumberNormalized: row.phoneNumberNormalized,
    contactName: row.contactName,
    callType: row.callType.toLowerCase(),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    simSlot: row.simSlot,
    simName: row.simName,
    source: row.source,
    employee: row.employee,
    device: { id: row.device.id, name: row.device.name, deviceId: row.device.deviceKey },
    lead: row.lead,
  };
}

/** Read/maintenance side of call history. Every query is org-scoped and RBAC-scoped. */
@Injectable()
export class MobileCallsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: EmployeeScopeService,
    private readonly leadAccess: LeadAccessService,
    private readonly pipelines: PipelinesService,
  ) {}

  private isOrgWide(actor: AuthenticatedEmployee) {
    return actor.role === Role.MASTER_OWNER || actor.role === Role.COMPANY_ADMIN;
  }

  /**
   * organizationId always; employee scope on top unless org-wide. Same
   * org-chart scoping leads/assignments already use, so an employee sees
   * only their own calls and a manager only their team's.
   */
  private async scopeWhere(actor: AuthenticatedEmployee): Promise<Prisma.MobileCallWhereInput> {
    if (this.isOrgWide(actor)) return { organizationId: actor.organizationId };
    return { organizationId: actor.organizationId, employeeId: { in: await this.scope.authorizedEmployeeIds(actor) } };
  }

  private async buildWhere(actor: AuthenticatedEmployee, f: Partial<CallFilters>): Promise<Prisma.MobileCallWhereInput> {
    const and: Prisma.MobileCallWhereInput[] = [await this.scopeWhere(actor)];

    if (f.employeeId) and.push({ employeeId: f.employeeId });
    if (f.deviceId) and.push({ deviceId: f.deviceId });
    if (f.leadId) and.push({ leadId: f.leadId });
    if (f.unassigned) and.push({ leadId: null });
    if (f.source) and.push({ source: f.source.toLowerCase() });
    if (f.from || f.to) and.push({ startedAt: { gte: f.from, lte: f.to } });
    if (f.minDuration !== undefined || f.maxDuration !== undefined) {
      and.push({ durationSeconds: { gte: f.minDuration, lte: f.maxDuration } });
    }
    if (f.callType) {
      const types = f.callType.split(",").map((t) => t.trim().toUpperCase());
      if (!types.every((t) => t in MobileCallType)) throw new BadRequestException("Unknown call_type filter");
      and.push({ callType: { in: types as MobileCallType[] } });
    }
    if (f.phoneNumber) {
      const digits = f.phoneNumber.replace(/\D/g, "");
      if (digits.length < 3) throw new BadRequestException("phone_number filter needs at least 3 digits");
      const phone = normalizeCallNumber(f.phoneNumber);
      // A full number matches on the indexed last-10 key; a fragment is a substring search.
      and.push(
        phone?.reliable
          ? { phoneLast10: phone.last10 }
          : { phoneNumberNormalized: { contains: digits } },
      );
    }
    if (f.q) {
      const q = cleanText(f.q, 60);
      if (q) and.push({ OR: [{ contactName: { contains: q, mode: "insensitive" } }, { phoneNumberOriginal: { contains: q } }] });
    }
    return { AND: and };
  }

  async list(actor: AuthenticatedEmployee, f: CallFilters) {
    const where = await this.buildWhere(actor, f);
    const [total, rows] = await Promise.all([
      this.prisma.mobileCall.count({ where }),
      this.prisma.mobileCall.findMany({
        where,
        select: listSelect,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        skip: (f.page - 1) * f.limit,
        take: f.limit,
      }),
    ]);
    return { items: rows.map(present), page: f.page, limit: f.limit, total };
  }

  async get(actor: AuthenticatedEmployee, id: string) {
    const where = await this.buildWhere(actor, {});
    // 404 (never 403) for anything outside the actor's org or scope.
    const row = await this.prisma.mobileCall.findFirst({
      where: { AND: [where, { id }] },
      select: { ...listSelect, externalId: true, androidCallId: true, metadata: true, syncedAt: true, createdAt: true },
    });
    if (!row) throw new NotFoundException("Call not found");
    return {
      ...present(row),
      externalId: row.externalId,
      androidCallId: row.androidCallId,
      metadata: row.metadata,
      syncedAt: row.syncedAt,
      createdAt: row.createdAt,
    };
  }

  /** Per-employee activity counts, e.g. "21 outgoing, 8 incoming, 4 missed, 1h34m". */
  async summary(actor: AuthenticatedEmployee, f: { from?: Date; to?: Date; employeeId?: string }) {
    const where = await this.buildWhere(actor, f);
    const groups = await this.prisma.mobileCall.groupBy({
      by: ["employeeId", "callType"],
      where,
      _count: { _all: true },
      _sum: { durationSeconds: true },
    });
    const employees = await this.prisma.employee.findMany({
      where: { organizationId: actor.organizationId, id: { in: [...new Set(groups.map((g) => g.employeeId))] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(employees.map((e) => [e.id, e.fullName]));

    const byEmployee = new Map<string, { employeeId: string; employeeName: string; incoming: number; outgoing: number; missed: number; other: number; totalCalls: number; totalDurationSeconds: number }>();
    for (const g of groups) {
      const row =
        byEmployee.get(g.employeeId) ??
        { employeeId: g.employeeId, employeeName: names.get(g.employeeId) ?? "Unknown", incoming: 0, outgoing: 0, missed: 0, other: 0, totalCalls: 0, totalDurationSeconds: 0 };
      const n = g._count._all;
      if (g.callType === "INCOMING") row.incoming += n;
      else if (g.callType === "OUTGOING") row.outgoing += n;
      else if (g.callType === "MISSED") row.missed += n;
      else row.other += n;
      row.totalCalls += n;
      row.totalDurationSeconds += g._sum.durationSeconds ?? 0;
      byEmployee.set(g.employeeId, row);
    }
    return { employees: [...byEmployee.values()].sort((a, b) => b.totalCalls - a.totalCalls) };
  }

  async remove(actor: AuthenticatedEmployee, id: string) {
    // Deleting is an admin action; the controller gates the role, and the
    // org filter below is the tenant boundary.
    const result = await this.prisma.mobileCall.deleteMany({ where: { id, organizationId: actor.organizationId } });
    if (result.count === 0) throw new NotFoundException("Call not found");
    await this.prisma.auditEvent.create({
      data: { organizationId: actor.organizationId, actorId: actor.id, action: "mobile_calls.deleted", targetType: "MobileCall", targetId: id, metadata: { scope: "single", count: 1 } },
    });
    return { ok: true };
  }

  async removeMany(actor: AuthenticatedEmployee, filters: Partial<CallFilters>) {
    if (!filters.from && !filters.to && !filters.employeeId && !filters.deviceId) {
      throw new BadRequestException("Refusing to delete without a filter (from/to, employee_id or device_id).");
    }
    const where = await this.buildWhere(actor, filters);
    const { count } = await this.prisma.mobileCall.deleteMany({ where });
    await this.prisma.auditEvent.create({
      data: { organizationId: actor.organizationId, actorId: actor.id, action: "mobile_calls.deleted", targetType: "MobileCall", metadata: { scope: "filter", count } },
    });
    return { ok: true, deleted: count };
  }

  async getSettings(actor: AuthenticatedEmployee) {
    const org = await this.prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { callRetentionDays: true } });
    return { callRetentionDays: org?.callRetentionDays ?? null };
  }

  async setRetention(actor: AuthenticatedEmployee, days: number | null) {
    await this.prisma.organization.update({ where: { id: actor.organizationId }, data: { callRetentionDays: days } });
    await this.prisma.auditEvent.create({
      data: { organizationId: actor.organizationId, actorId: actor.id, action: "mobile_calls.retention_changed", targetType: "Organization", targetId: actor.organizationId, metadata: { days } },
    });
    return { callRetentionDays: days };
  }

  /** Daily retention sweep (see MobileRetentionService). */
  async purgeExpired(): Promise<number> {
    const orgs = await this.prisma.organization.findMany({ where: { callRetentionDays: { not: null } }, select: { id: true, callRetentionDays: true } });
    let total = 0;
    for (const org of orgs) {
      const cutoff = new Date(Date.now() - (org.callRetentionDays as number) * 86_400_000);
      const { count } = await this.prisma.mobileCall.deleteMany({ where: { organizationId: org.id, startedAt: { lt: cutoff } } });
      if (count > 0) {
        total += count;
        await this.prisma.auditEvent.create({
          data: { organizationId: org.id, action: "mobile_calls.retention_purge", targetType: "Organization", targetId: org.id, metadata: { count, retentionDays: org.callRetentionDays } },
        });
      }
    }
    return total;
  }

  private async loadScopedCall(actor: AuthenticatedEmployee, id: string) {
    const call = await this.prisma.mobileCall.findFirst({ where: { AND: [await this.scopeWhere(actor), { id }] } });
    if (!call) throw new NotFoundException("Call not found");
    return call;
  }

  /** Links this call — and every other unassigned call from the same number — to a lead the actor may access. */
  async attachToLead(actor: AuthenticatedEmployee, id: string, leadId: string) {
    const call = await this.loadScopedCall(actor, id);
    const lead = await this.leadAccess.findScopedLead(actor, leadId); // org + RBAC checked
    const { count } = await this.prisma.mobileCall.updateMany({
      where: { organizationId: actor.organizationId, leadId: null, phoneLast10: call.phoneLast10 },
      data: { leadId: lead.id },
    });
    await this.prisma.mobileCall.updateMany({ where: { id: call.id, organizationId: actor.organizationId }, data: { leadId: lead.id } });
    return { ok: true, leadId: lead.id, linked: count };
  }

  /** The explicit "Create Contact" action — calls never auto-create leads. */
  async createLeadFromCall(actor: AuthenticatedEmployee, id: string, fullName?: string) {
    const call = await this.loadScopedCall(actor, id);
    if (call.leadId) throw new BadRequestException("This call is already linked to a lead");
    const pipeline = await this.pipelines.getOrCreateLeadPipeline(actor.organizationId);
    const first = pipeline.stages[0];
    const name = cleanText(fullName ?? "", 120) || call.contactName || call.phoneNumberNormalized;

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          organizationId: actor.organizationId,
          fullName: name,
          phone: call.phoneNumberNormalized,
          source: "PHONE_CALL",
          ownerId: actor.id,
          createdById: actor.id,
          pipelineId: pipeline.id,
          stageId: first?.id,
          stageChangedAt: first ? new Date() : undefined,
        },
      });
      await tx.leadActivity.create({
        data: {
          organizationId: actor.organizationId,
          leadId: created.id,
          actorId: actor.id,
          type: LeadActivityType.NOTE,
          body: "Lead created from an unassigned phone call",
        },
      });
      await tx.mobileCall.updateMany({
        where: { organizationId: actor.organizationId, leadId: null, phoneLast10: call.phoneLast10 },
        data: { leadId: created.id },
      });
      return created;
    });
    return { ok: true, leadId: lead.id };
  }

  assertAdminForEmployeeFilter(actor: AuthenticatedEmployee, employeeId?: string) {
    if (employeeId && !this.isOrgWide(actor) && employeeId !== actor.id) {
      // scopeWhere already narrows results; this makes an out-of-scope request explicit.
      return this.scope.isInScope(actor, employeeId).then((ok) => {
        if (!ok) throw new ForbiddenException("Not authorized to view that employee's calls");
      });
    }
    return Promise.resolve();
  }
}
