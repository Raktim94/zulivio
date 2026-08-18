import { ForbiddenException, Injectable } from "@nestjs/common";
import { AssignmentStatus, LeadStatus, OpportunityStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";


@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  /** Org-wide "master database view" dashboard: headcount, assignment mix, live attendance, overdue work. */
  async dashboard(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Dashboard is restricted to managers and above");
    }

    const orgId = actor.organizationId;

    const [
      totalEmployees,
      activeEmployees,
      assignmentsByStatus,
      overdueAssignments,
      openWorkSessions,
      documentsPublished,
      tipsPublished,
    ] = await Promise.all([
      this.prisma.employee.count({ where: { organizationId: orgId } }),
      this.prisma.employee.count({ where: { organizationId: orgId, employmentStatus: "ACTIVE" } }),
      this.prisma.assignment.groupBy({
        by: ["status"],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
      this.prisma.assignment.count({
        where: {
          organizationId: orgId,
          dueAt: { lt: new Date() },
          status: { notIn: [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELED] },
        },
      }),
      this.prisma.workSession.findMany({
        where: { organizationId: orgId, endedAt: null },
        include: { breaks: true, employee: { select: { id: true, fullName: true, employeeNumber: true } } },
      }),
      this.prisma.knowledgeDocument.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
      this.prisma.tip.count({ where: { organizationId: orgId } }),
    ]);

    const liveAttendance = openWorkSessions.map((s) => ({
      employeeId: s.employee.id,
      employeeName: s.employee.fullName,
      employeeNumber: s.employee.employeeNumber,
      state: s.breaks.some((b) => !b.endedAt) ? "on_break" : "working",
      startedAt: s.startedAt,
    }));

    return {
      generatedAt: new Date().toISOString(),
      headcount: { total: totalEmployees, active: activeEmployees },
      assignments: {
        byStatus: Object.fromEntries(assignmentsByStatus.map((row) => [row.status, row._count._all])),
        overdue: overdueAssignments,
      },
      liveAttendance,
      workingNow: liveAttendance.filter((a) => a.state === "working").length,
      onBreakNow: liveAttendance.filter((a) => a.state === "on_break").length,
      knowledge: { documentsPublished, tipsPublished },
    };
  }

  /** Full "employee total report": hours, breaks, assignment outcomes — everything a manager needs in one view. */
  async employeeTotalReport(actor: AuthenticatedEmployee, employeeId: string, from?: Date, to?: Date) {
    if (employeeId !== actor.id && !(await this.employeeScope.isInScope(actor, employeeId))) {
      throw new ForbiddenException("Cannot view another employee's report");
    }

    const [attendance, assignmentCounts, trainingAck] = await Promise.all([
      this.attendanceService.report(actor, employeeId, from, to),
      this.prisma.assignment.groupBy({
        by: ["status"],
        where: {
          organizationId: actor.organizationId,
          ownerId: employeeId,
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
      }),
      this.prisma.trainingResult.count({
        where: { employeeId, acknowledgedAt: { not: null } },
      }),
    ]);

    const byStatus = Object.fromEntries(assignmentCounts.map((row) => [row.status, row._count._all]));
    const totalAssigned = assignmentCounts.reduce((sum, row) => sum + row._count._all, 0);

    return {
      attendance,
      assignments: {
        total: totalAssigned,
        completed: byStatus[AssignmentStatus.COMPLETED] ?? 0,
        followUp: byStatus[AssignmentStatus.FOLLOW_UP] ?? 0,
        blocked: byStatus[AssignmentStatus.BLOCKED] ?? 0,
        inProgress: byStatus[AssignmentStatus.IN_PROGRESS] ?? 0,
        canceled: byStatus[AssignmentStatus.CANCELED] ?? 0,
      },
      trainingAcknowledged: trainingAck,
    };
  }

  /** Sales dashboard: pipeline value by stage, lead funnel, forecast rollup, overdue leads. */
  async salesDashboard(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Sales dashboard is restricted to managers and above");
    }

    const orgId = actor.organizationId;

    // COMPANY_ADMIN/MASTER_OWNER see the whole org, including unassigned
    // records — no owner filter. MANAGER (direct reports) and SALES_HEAD
    // (full reporting subtree) are scoped to their authorized team's owned
    // records — previously this was org-wide for any manager+, letting one
    // team's manager see every other team's pipeline and revenue data.
    const isFullOrgScope = actor.role === Role.COMPANY_ADMIN || actor.role === Role.MASTER_OWNER;
    const ownerFilter = isFullOrgScope
      ? {}
      : { ownerId: { in: await this.employeeScope.authorizedEmployeeIds(actor) } };

    // UTC throughout — mixing local setHours() with toISOString()'s UTC
    // output shifts the day boundary by the server's UTC offset (this broke
    // under IST until caught by a test asserting on "today"'s bucket).
    const now = new Date();
    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13));

    const [
      pipeline,
      openOpportunities,
      leadsByStatus,
      overdueLeads,
      wonCount,
      lostCount,
      closedOpportunitiesInWindow,
      leadsInWindow,
    ] = await Promise.all([
      this.prisma.pipeline.findFirst({
        where: { organizationId: orgId, isDefault: true },
        include: { stages: { orderBy: { sortOrder: "asc" } } },
      }),
      this.prisma.opportunity.findMany({
        where: { organizationId: orgId, status: OpportunityStatus.OPEN, ...ownerFilter },
        include: {
          stage: { select: { id: true, name: true, sortOrder: true, probability: true } },
          owner: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.lead.groupBy({
        by: ["status"],
        where: { organizationId: orgId, ...ownerFilter },
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: {
          organizationId: orgId,
          respondBySlaAt: { lt: new Date() },
          firstRespondedAt: null,
          status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
          ...ownerFilter,
        },
      }),
      this.prisma.opportunity.count({
        where: { organizationId: orgId, status: OpportunityStatus.WON, ...ownerFilter },
      }),
      this.prisma.opportunity.count({
        where: { organizationId: orgId, status: OpportunityStatus.LOST, ...ownerFilter },
      }),
      // stageChangedAt is the closest proxy to a "closedAt" timestamp — the
      // Opportunity model has no dedicated one, and a WON/LOST opportunity's
      // stage only changes again on close in practice.
      this.prisma.opportunity.findMany({
        where: {
          organizationId: orgId,
          status: { in: [OpportunityStatus.WON, OpportunityStatus.LOST] },
          stageChangedAt: { gte: trendStart },
          ...ownerFilter,
        },
        select: { status: true, stageChangedAt: true },
      }),
      this.prisma.lead.findMany({
        where: { organizationId: orgId, createdAt: { gte: trendStart }, ...ownerFilter },
        select: { createdAt: true },
      }),
    ]);

    const stageBreakdown = (pipeline?.stages ?? []).map((stage) => {
      const inStage = openOpportunities.filter((o) => o.stageId === stage.id);
      return {
        stageId: stage.id,
        stageName: stage.name,
        count: inStage.length,
        valueMinor: inStage.reduce((sum, o) => sum + o.amountMinor, 0),
        opportunityIds: inStage.map((o) => o.id),
      };
    });

    const totalPipelineValueMinor = openOpportunities.reduce((sum, o) => sum + o.amountMinor, 0);
    const weightedForecastMinor = openOpportunities.reduce(
      (sum, o) => sum + Math.round((o.amountMinor * o.stage.probability) / 100),
      0,
    );

    const forecastByCategory: Record<string, number> = {};
    for (const o of openOpportunities) {
      forecastByCategory[o.forecastCategory] = (forecastByCategory[o.forecastCategory] ?? 0) + o.amountMinor;
    }

    const byOwnerMap = new Map<
      string,
      {
        ownerId: string;
        ownerName: string;
        valueMinor: number;
        weightedForecastMinor: number;
        count: number;
        forecastByCategory: Record<string, number>;
        opportunityIds: string[];
      }
    >();
    for (const o of openOpportunities) {
      if (!o.owner) continue;
      const existing = byOwnerMap.get(o.owner.id) ?? {
        ownerId: o.owner.id,
        ownerName: o.owner.fullName,
        valueMinor: 0,
        weightedForecastMinor: 0,
        count: 0,
        forecastByCategory: {},
        opportunityIds: [],
      };
      existing.valueMinor += o.amountMinor;
      existing.weightedForecastMinor += Math.round((o.amountMinor * o.stage.probability) / 100);
      existing.count += 1;
      existing.forecastByCategory[o.forecastCategory] =
        (existing.forecastByCategory[o.forecastCategory] ?? 0) + o.amountMinor;
      existing.opportunityIds.push(o.id);
      byOwnerMap.set(o.owner.id, existing);
    }

    // Period-over-period trend: won/lost opportunities and new leads per day,
    // for the last 14 days — lets the dashboard show momentum, not just a
    // point-in-time snapshot.
    const dailyTrendMap = new Map<string, { date: string; won: number; lost: number; newLeads: number }>();
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(trendStart);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailyTrendMap.set(key, { date: key, won: 0, lost: 0, newLeads: 0 });
    }
    for (const o of closedOpportunitiesInWindow) {
      const key = o.stageChangedAt.toISOString().slice(0, 10);
      const bucket = dailyTrendMap.get(key);
      if (!bucket) continue;
      if (o.status === OpportunityStatus.WON) bucket.won += 1;
      else bucket.lost += 1;
    }
    for (const lead of leadsInWindow) {
      const key = lead.createdAt.toISOString().slice(0, 10);
      const bucket = dailyTrendMap.get(key);
      if (bucket) bucket.newLeads += 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      pipelineValue: { totalMinor: totalPipelineValueMinor, weightedForecastMinor },
      stageBreakdown,
      forecastByCategory,
      byOwner: Array.from(byOwnerMap.values()),
      leadFunnel: Object.fromEntries(leadsByStatus.map((row) => [row.status, row._count._all])),
      overdueLeads,
      winLoss: { won: wonCount, lost: lostCount },
      dailyTrend: Array.from(dailyTrendMap.values()),
    };
  }
}
