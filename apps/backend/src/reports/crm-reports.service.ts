import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CallOutcome,
  FollowUpStatus,
  LeadActivityType,
  LeadStatus,
  OpportunityStatus,
  PipelineKind,
  Role,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Telecalling analytics for the manager and admin dashboards.
 *
 * Kept separate from ReportsService.salesDashboard (which is about
 * *opportunity* forecasting) because these answer a different question —
 * how the calling floor is performing — and mixing them would have made one
 * already-large method carry two unrelated shapes.
 *
 * Scoping mirrors the rest of the CRM: COMPANY_ADMIN/MASTER_OWNER see the
 * whole organization, SALES_HEAD their reporting subtree, MANAGER their
 * direct reports. An EMPLOYEE never reaches these endpoints.
 */
@Injectable()
export class CrmReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: EmployeeScopeService,
  ) {}

  private async resolveScope(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("CRM reporting is restricted to managers and above");
    }
    const orgWide = actor.role === Role.COMPANY_ADMIN || actor.role === Role.MASTER_OWNER;
    const employeeIds = orgWide ? null : await this.scope.authorizedEmployeeIds(actor);
    return { orgWide, employeeIds };
  }

  /**
   * Team KPIs plus a per-employee performance table.
   *
   * `from`/`to` bound *lead creation* and *activity* windows. Won/lost and
   * revenue come from Opportunity, which is the only place a real amount
   * lives — lead-side "revenue" would be a guess.
   */
  async teamPerformance(actor: AuthenticatedEmployee, from?: Date, to?: Date) {
    const { orgWide, employeeIds } = await this.resolveScope(actor);
    const orgId = actor.organizationId;
    const window = resolveWindow(from, to);

    const ownerFilter: Prisma.LeadWhereInput = orgWide ? {} : { ownerId: { in: employeeIds ?? [] } };
    const oppOwnerFilter: Prisma.OpportunityWhereInput = orgWide
      ? {}
      : { ownerId: { in: employeeIds ?? [] } };
    const actorFilter: Prisma.LeadActivityWhereInput = orgWide
      ? {}
      : { actorId: { in: employeeIds ?? [] } };

    const leadWindow: Prisma.LeadWhereInput = {
      organizationId: orgId,
      ...ownerFilter,
      createdAt: { gte: window.from, lte: window.to },
    };

    const leadPipeline = await this.prisma.pipeline.findFirst({
      where: { organizationId: orgId, kind: PipelineKind.LEAD },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
    const stages = leadPipeline?.stages ?? [];

    const [
      totalLeads,
      byStatus,
      byStage,
      bySource,
      callActivity,
      wonOpportunities,
      lostCount,
      followUpsCompleted,
      followUpsOverdue,
      members,
    ] = await Promise.all([
      this.prisma.lead.count({ where: leadWindow }),
      this.prisma.lead.groupBy({ by: ["status"], where: leadWindow, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["stageId"], where: leadWindow, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["source"], where: leadWindow, _count: { _all: true } }),
      this.prisma.leadActivity.groupBy({
        by: ["actorId", "callOutcome"],
        where: {
          organizationId: orgId,
          type: LeadActivityType.CALL,
          createdAt: { gte: window.from, lte: window.to },
          ...actorFilter,
        },
        _count: { _all: true },
      }),
      this.prisma.opportunity.findMany({
        where: {
          organizationId: orgId,
          status: OpportunityStatus.WON,
          stageChangedAt: { gte: window.from, lte: window.to },
          ...oppOwnerFilter,
        },
        select: { ownerId: true, amountMinor: true, stageChangedAt: true },
      }),
      this.prisma.opportunity.count({
        where: {
          organizationId: orgId,
          status: OpportunityStatus.LOST,
          stageChangedAt: { gte: window.from, lte: window.to },
          ...oppOwnerFilter,
        },
      }),
      this.prisma.leadFollowUp.groupBy({
        by: ["assigneeId"],
        where: {
          organizationId: orgId,
          status: FollowUpStatus.COMPLETED,
          completedAt: { gte: window.from, lte: window.to },
          ...(orgWide ? {} : { assigneeId: { in: employeeIds ?? [] } }),
        },
        _count: { _all: true },
      }),
      this.prisma.leadFollowUp.groupBy({
        by: ["assigneeId"],
        where: {
          organizationId: orgId,
          status: FollowUpStatus.PENDING,
          dueAt: { lt: new Date() },
          ...(orgWide ? {} : { assigneeId: { in: employeeIds ?? [] } }),
        },
        _count: { _all: true },
      }),
      this.prisma.employee.findMany({
        where: {
          organizationId: orgId,
          ...(orgWide ? {} : { id: { in: employeeIds ?? [] } }),
        },
        select: { id: true, fullName: true, employeeNumber: true, role: true, employmentStatus: true },
        orderBy: { employeeNumber: "asc" },
      }),
    ]);

    const statusCounts = countsFrom(byStatus, "status");
    const stageNameById = new Map(stages.map((s) => [s.id, s.name]));

    const stageCounts = stages.map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      count: byStage.find((row) => row.stageId === stage.id)?._count._all ?? 0,
    }));

    const revenueMinor = wonOpportunities.reduce((sum, o) => sum + o.amountMinor, 0);
    const wonCount = wonOpportunities.length;

    // Per-employee rollup. Built by walking the members list rather than the
    // aggregate rows, so somebody with a quiet month still appears with
    // zeroes instead of vanishing from the comparison chart.
    const perEmployee = await this.perEmployeeRows({
      members,
      orgId,
      window,
      callActivity,
      wonOpportunities,
      followUpsCompleted,
      followUpsOverdue,
    });

    return {
      generatedAt: new Date().toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      kpis: {
        totalLeads,
        new: statusCounts[LeadStatus.NEW] ?? 0,
        contacted: statusCounts[LeadStatus.CONTACTED] ?? 0,
        qualified: statusCounts[LeadStatus.QUALIFIED] ?? 0,
        disqualified: statusCounts[LeadStatus.DISQUALIFIED] ?? 0,
        converted: statusCounts[LeadStatus.CONVERTED] ?? 0,
        connected: stageCount(stageCounts, "Connected"),
        meetingsBooked: stageCount(stageCounts, "Meeting Booked"),
        proposalsSent: stageCount(stageCounts, "Proposal Sent"),
        negotiation: stageCount(stageCounts, "Negotiation"),
        won: wonCount,
        lost: lostCount,
        revenueMinor,
        conversionRate: percentage(statusCounts[LeadStatus.CONVERTED] ?? 0, totalLeads),
      },
      leadsByStage: stageCounts,
      leadsBySource: bySource.map((row) => ({
        source: row.source ?? "Unattributed",
        count: row._count._all,
      })),
      perEmployee,
      stageNames: Array.from(stageNameById.values()),
    };
  }

  private async perEmployeeRows(input: {
    members: { id: string; fullName: string; employeeNumber: string; role: Role; employmentStatus: string }[];
    orgId: string;
    window: { from: Date; to: Date };
    callActivity: { actorId: string; callOutcome: CallOutcome | null; _count: { _all: number } }[];
    wonOpportunities: { ownerId: string | null; amountMinor: number }[];
    followUpsCompleted: { assigneeId: string; _count: { _all: number } }[];
    followUpsOverdue: { assigneeId: string; _count: { _all: number } }[];
  }) {
    const { members, orgId, window, callActivity, wonOpportunities, followUpsCompleted, followUpsOverdue } =
      input;
    const memberIds = members.map((m) => m.id);
    if (memberIds.length === 0) return [];

    const [leadsHandled, leadsQualified, leadsConverted, meetingsBooked] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ["ownerId"],
        where: {
          organizationId: orgId,
          ownerId: { in: memberIds },
          createdAt: { gte: window.from, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ["ownerId"],
        where: {
          organizationId: orgId,
          ownerId: { in: memberIds },
          qualifiedAt: { gte: window.from, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ["ownerId"],
        where: {
          organizationId: orgId,
          ownerId: { in: memberIds },
          status: LeadStatus.CONVERTED,
          updatedAt: { gte: window.from, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.leadActivity.groupBy({
        by: ["actorId"],
        where: {
          organizationId: orgId,
          actorId: { in: memberIds },
          type: LeadActivityType.CALL,
          callDisposition: "MEETING_BOOKED",
          createdAt: { gte: window.from, lte: window.to },
        },
        _count: { _all: true },
      }),
    ]);

    const by = <T extends { _count: { _all: number } }>(rows: T[], key: keyof T, id: string) =>
      rows.find((row) => row[key] === id)?._count._all ?? 0;

    return members.map((member) => {
      const calls = callActivity
        .filter((row) => row.actorId === member.id)
        .reduce((sum, row) => sum + row._count._all, 0);
      const connected = callActivity
        .filter((row) => row.actorId === member.id && row.callOutcome === CallOutcome.CONNECTED)
        .reduce((sum, row) => sum + row._count._all, 0);
      const won = wonOpportunities.filter((o) => o.ownerId === member.id);
      const handled = by(leadsHandled, "ownerId", member.id);
      const converted = by(leadsConverted, "ownerId", member.id);

      return {
        employeeId: member.id,
        employeeNumber: member.employeeNumber,
        fullName: member.fullName,
        role: member.role,
        employmentStatus: member.employmentStatus,
        calls,
        connected,
        connectRate: percentage(connected, calls),
        leadsHandled: handled,
        leadsQualified: by(leadsQualified, "ownerId", member.id),
        leadsConverted: converted,
        followUpsCompleted: by(followUpsCompleted, "assigneeId", member.id),
        followUpsOverdue: by(followUpsOverdue, "assigneeId", member.id),
        meetingsBooked: by(meetingsBooked, "actorId", member.id),
        dealsWon: won.length,
        revenueMinor: won.reduce((sum, o) => sum + o.amountMinor, 0),
        conversionRate: percentage(converted, handled),
      };
    });
  }

  /**
   * Admin CRM overview: the whole organization's funnel, sources, revenue
   * and follow-up health, plus the daily series the trend charts need.
   */
  async crmOverview(actor: AuthenticatedEmployee, from?: Date, to?: Date) {
    if (actor.role !== Role.COMPANY_ADMIN && actor.role !== Role.MASTER_OWNER) {
      throw new ForbiddenException("The CRM overview is restricted to administrators");
    }
    const orgId = actor.organizationId;
    const window = resolveWindow(from, to);

    const leadPipeline = await this.prisma.pipeline.findFirst({
      where: { organizationId: orgId, kind: PipelineKind.LEAD },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
    const stages = leadPipeline?.stages ?? [];

    const leadWindow: Prisma.LeadWhereInput = {
      organizationId: orgId,
      createdAt: { gte: window.from, lte: window.to },
    };

    const [
      totalLeads,
      activeEmployees,
      byStage,
      bySource,
      byStatus,
      assignmentDistribution,
      openOpportunities,
      wonInWindow,
      lostInWindow,
      followUpStats,
      overdueFollowUps,
      leadsInWindow,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { organizationId: orgId } }),
      this.prisma.employee.count({ where: { organizationId: orgId, employmentStatus: "ACTIVE" } }),
      this.prisma.lead.groupBy({ by: ["stageId"], where: leadWindow, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["source"], where: leadWindow, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["status"], where: leadWindow, _count: { _all: true } }),
      this.prisma.lead.groupBy({
        by: ["ownerId"],
        where: { organizationId: orgId, status: { notIn: [LeadStatus.CONVERTED, LeadStatus.DISQUALIFIED] } },
        _count: { _all: true },
      }),
      this.prisma.opportunity.findMany({
        where: { organizationId: orgId, status: OpportunityStatus.OPEN },
        include: { stage: { select: { id: true, name: true, probability: true, sortOrder: true } } },
      }),
      this.prisma.opportunity.findMany({
        where: {
          organizationId: orgId,
          status: OpportunityStatus.WON,
          stageChangedAt: { gte: window.from, lte: window.to },
        },
        select: { amountMinor: true, stageChangedAt: true },
      }),
      this.prisma.opportunity.count({
        where: {
          organizationId: orgId,
          status: OpportunityStatus.LOST,
          stageChangedAt: { gte: window.from, lte: window.to },
        },
      }),
      this.prisma.leadFollowUp.groupBy({
        by: ["status"],
        where: { organizationId: orgId, createdAt: { gte: window.from, lte: window.to } },
        _count: { _all: true },
      }),
      this.prisma.leadFollowUp.count({
        where: { organizationId: orgId, status: FollowUpStatus.PENDING, dueAt: { lt: new Date() } },
      }),
      this.prisma.lead.findMany({
        where: leadWindow,
        select: { createdAt: true, status: true },
      }),
    ]);

    const ownerNames = await this.prisma.employee.findMany({
      where: { id: { in: assignmentDistribution.map((r) => r.ownerId).filter(isString) } },
      select: { id: true, fullName: true, employeeNumber: true },
    });
    const ownerById = new Map(ownerNames.map((o) => [o.id, o]));

    const statusCounts = countsFrom(byStatus, "status");
    const pipelineValueByStage = groupOpportunityValue(openOpportunities);

    return {
      generatedAt: new Date().toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      totals: {
        totalLeads,
        activeEmployees,
        leadsInWindow: leadsInWindow.length,
        revenueMinor: wonInWindow.reduce((sum, o) => sum + o.amountMinor, 0),
        openPipelineMinor: openOpportunities.reduce((sum, o) => sum + o.amountMinor, 0),
        weightedPipelineMinor: openOpportunities.reduce(
          (sum, o) => sum + Math.round((o.amountMinor * o.stage.probability) / 100),
          0,
        ),
        won: wonInWindow.length,
        lost: lostInWindow,
        conversionRate: percentage(statusCounts[LeadStatus.CONVERTED] ?? 0, leadsInWindow.length),
      },
      leadsByStage: stages.map((stage) => ({
        stageId: stage.id,
        stageName: stage.name,
        sortOrder: stage.sortOrder,
        count: byStage.find((row) => row.stageId === stage.id)?._count._all ?? 0,
      })),
      leadsBySource: bySource.map((row) => ({
        source: row.source ?? "Unattributed",
        count: row._count._all,
      })),
      // The funnel is the stage list in board order — a real funnel, not the
      // five coarse statuses, which don't narrow monotonically.
      funnel: stages
        .filter((stage) => !stage.isLost)
        .map((stage) => ({
          label: stage.name,
          count: byStage.find((row) => row.stageId === stage.id)?._count._all ?? 0,
        })),
      pipelineValueByStage,
      assignmentDistribution: assignmentDistribution.map((row) => ({
        ownerId: row.ownerId,
        ownerName: row.ownerId
          ? (ownerById.get(row.ownerId)?.fullName ?? "Unknown")
          : "Unassigned",
        openLeads: row._count._all,
      })),
      followUpPerformance: {
        completed: followUpStats.find((r) => r.status === FollowUpStatus.COMPLETED)?._count._all ?? 0,
        pending: followUpStats.find((r) => r.status === FollowUpStatus.PENDING)?._count._all ?? 0,
        canceled: followUpStats.find((r) => r.status === FollowUpStatus.CANCELED)?._count._all ?? 0,
        overdue: overdueFollowUps,
      },
      dailyTrend: buildDailyTrend(window, leadsInWindow, wonInWindow),
    };
  }
}

function isString(value: string | null): value is string {
  return value !== null;
}

function resolveWindow(from?: Date, to?: Date) {
  const resolvedTo = to ?? new Date();
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60_000);
  // A reversed range would silently return zeroes everywhere; swap instead.
  return resolvedFrom <= resolvedTo
    ? { from: resolvedFrom, to: resolvedTo }
    : { from: resolvedTo, to: resolvedFrom };
}

function countsFrom<K extends string>(
  rows: ({ _count: { _all: number } } & Record<K, string>)[],
  key: K,
): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row[key], row._count._all]));
}

function stageCount(rows: { stageName: string; count: number }[], name: string): number {
  return rows.find((row) => row.stageName.toLowerCase() === name.toLowerCase())?.count ?? 0;
}

/** Whole-number percent, and 0 rather than NaN when the denominator is zero. */
function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function groupOpportunityValue(
  opportunities: { amountMinor: number; stage: { id: string; name: string; sortOrder: number } }[],
) {
  const map = new Map<string, { stageId: string; stageName: string; sortOrder: number; valueMinor: number; count: number }>();
  for (const o of opportunities) {
    const entry = map.get(o.stage.id) ?? {
      stageId: o.stage.id,
      stageName: o.stage.name,
      sortOrder: o.stage.sortOrder,
      valueMinor: 0,
      count: 0,
    };
    entry.valueMinor += o.amountMinor;
    entry.count += 1;
    map.set(o.stage.id, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Daily new-leads / conversions / revenue series, in UTC.
 *
 * UTC is deliberate and matches ReportsService.salesDashboard: mixing local
 * setHours() with toISOString()'s UTC output shifts the day boundary by the
 * server's offset, which previously produced an off-by-one "today" bucket
 * under IST.
 */
function buildDailyTrend(
  window: { from: Date; to: Date },
  leads: { createdAt: Date; status: LeadStatus }[],
  won: { amountMinor: number; stageChangedAt: Date }[],
) {
  const days = new Map<string, { date: string; newLeads: number; converted: number; revenueMinor: number }>();
  const cursor = new Date(
    Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), window.from.getUTCDate()),
  );
  const end = new Date(Date.UTC(window.to.getUTCFullYear(), window.to.getUTCMonth(), window.to.getUTCDate()));

  // Capped at 180 buckets so an accidental multi-year range can't build a
  // response with thousands of points nothing can render.
  let guard = 0;
  while (cursor <= end && guard < 180) {
    const key = cursor.toISOString().slice(0, 10);
    days.set(key, { date: key, newLeads: 0, converted: 0, revenueMinor: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }

  for (const lead of leads) {
    const bucket = days.get(lead.createdAt.toISOString().slice(0, 10));
    if (!bucket) continue;
    bucket.newLeads += 1;
    if (lead.status === LeadStatus.CONVERTED) bucket.converted += 1;
  }
  for (const o of won) {
    const bucket = days.get(o.stageChangedAt.toISOString().slice(0, 10));
    if (bucket) bucket.revenueMinor += o.amountMinor;
  }

  return Array.from(days.values());
}
