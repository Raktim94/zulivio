import { ForbiddenException, Injectable } from "@nestjs/common";
import { AssignmentStatus, LeadStatus, OpportunityStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";

const MANAGER_RANK: Role[] = [Role.MANAGER, Role.SALES_HEAD, Role.COMPANY_ADMIN, Role.MASTER_OWNER];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
  ) {}

  /** Org-wide "master database view" dashboard: headcount, assignment mix, live attendance, overdue work. */
  async dashboard(actor: AuthenticatedEmployee) {
    if (!MANAGER_RANK.includes(actor.role)) {
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
    if (employeeId !== actor.id && !MANAGER_RANK.includes(actor.role)) {
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
    if (!MANAGER_RANK.includes(actor.role)) {
      throw new ForbiddenException("Sales dashboard is restricted to managers and above");
    }

    const orgId = actor.organizationId;

    const [pipeline, openOpportunities, leadsByStatus, overdueLeads, wonCount, lostCount] = await Promise.all([
      this.prisma.pipeline.findFirst({
        where: { organizationId: orgId, isDefault: true },
        include: { stages: { orderBy: { sortOrder: "asc" } } },
      }),
      this.prisma.opportunity.findMany({
        where: { organizationId: orgId, status: OpportunityStatus.OPEN },
        include: {
          stage: { select: { id: true, name: true, sortOrder: true, probability: true } },
          owner: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.lead.groupBy({
        by: ["status"],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: {
          organizationId: orgId,
          respondBySlaAt: { lt: new Date() },
          firstRespondedAt: null,
          status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
        },
      }),
      this.prisma.opportunity.count({ where: { organizationId: orgId, status: OpportunityStatus.WON } }),
      this.prisma.opportunity.count({ where: { organizationId: orgId, status: OpportunityStatus.LOST } }),
    ]);

    const stageBreakdown = (pipeline?.stages ?? []).map((stage) => {
      const inStage = openOpportunities.filter((o) => o.stageId === stage.id);
      return {
        stageId: stage.id,
        stageName: stage.name,
        count: inStage.length,
        valueMinor: inStage.reduce((sum, o) => sum + o.amountMinor, 0),
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
      };
      existing.valueMinor += o.amountMinor;
      existing.weightedForecastMinor += Math.round((o.amountMinor * o.stage.probability) / 100);
      existing.count += 1;
      existing.forecastByCategory[o.forecastCategory] =
        (existing.forecastByCategory[o.forecastCategory] ?? 0) + o.amountMinor;
      byOwnerMap.set(o.owner.id, existing);
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
    };
  }
}
