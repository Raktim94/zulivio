import { ForbiddenException, Injectable } from "@nestjs/common";
import { AssignmentStatus, Role } from "@prisma/client";
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
}
