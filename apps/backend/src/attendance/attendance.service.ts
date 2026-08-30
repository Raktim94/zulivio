import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadActivityType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: EmployeeScopeService,
  ) {}

  private async findOpenSession(employeeId: string) {
    return this.prisma.workSession.findFirst({
      where: { employeeId, endedAt: null },
      include: { breaks: true },
    });
  }

  async start(actor: AuthenticatedEmployee) {
    const open = await this.findOpenSession(actor.id);
    if (open) {
      throw new BadRequestException("A work session is already open. End it before starting a new one.");
    }

    return this.prisma.workSession.create({
      data: { organizationId: actor.organizationId, employeeId: actor.id },
    });
  }

  async startBreak(actor: AuthenticatedEmployee, sessionId: string, reason?: string) {
    const session = await this.getOwnedOpenSession(actor, sessionId);
    const openBreak = session.breaks.find((b) => !b.endedAt);
    if (openBreak) {
      throw new BadRequestException("Already on break.");
    }

    return this.prisma.break.create({
      data: { workSessionId: sessionId, reason },
    });
  }

  async endBreak(actor: AuthenticatedEmployee, sessionId: string, breakId: string) {
    const session = await this.getOwnedOpenSession(actor, sessionId);
    const targetBreak = session.breaks.find((b) => b.id === breakId);
    if (!targetBreak) throw new NotFoundException("Break not found on this session");
    if (targetBreak.endedAt) throw new BadRequestException("Break already ended");

    return this.prisma.break.update({
      where: { id: breakId },
      data: { endedAt: new Date() },
    });
  }

  async endSession(actor: AuthenticatedEmployee, sessionId: string) {
    const session = await this.getOwnedOpenSession(actor, sessionId);

    return this.prisma.$transaction(async (tx) => {
      // Auto-close any dangling open break so duration math stays sane —
      // an employee ending their shift mid-break shouldn't produce an
      // open-ended break record.
      const openBreak = session.breaks.find((b) => !b.endedAt);
      if (openBreak) {
        await tx.break.update({ where: { id: openBreak.id }, data: { endedAt: new Date() } });
      }

      return tx.workSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date() },
      });
    });
  }

  private async getOwnedOpenSession(actor: AuthenticatedEmployee, sessionId: string) {
    const session = await this.prisma.workSession.findFirst({
      where: { id: sessionId, organizationId: actor.organizationId },
      include: { breaks: true },
    });
    if (!session) throw new NotFoundException("Work session not found");
    if (session.employeeId !== actor.id) {
      throw new ForbiddenException("Cannot modify another employee's work session");
    }
    if (session.endedAt) {
      throw new BadRequestException("Work session already ended");
    }
    return session;
  }

  async currentStatus(actor: AuthenticatedEmployee) {
    const open = await this.findOpenSession(actor.id);
    if (!open) return { state: "logged_out" as const };

    const openBreak = open.breaks.find((b) => !b.endedAt);
    return {
      state: openBreak ? ("on_break" as const) : ("working" as const),
      sessionId: open.id,
      startedAt: open.startedAt,
      currentBreakId: openBreak?.id,
    };
  }

  /** Employee report: total sessions, net working time, break time, for a date range. Managers may query any employee in scope. */
  async report(actor: AuthenticatedEmployee, employeeId: string, from?: Date, to?: Date) {
    if (employeeId !== actor.id && !isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Cannot view another employee's attendance report");
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    const sessions = await this.prisma.workSession.findMany({
      where: {
        employeeId,
        organizationId: actor.organizationId,
        startedAt: { gte: from, lte: to },
      },
      include: { breaks: true },
      orderBy: { startedAt: "desc" },
    });

    let totalWorkedMs = 0;
    let totalBreakMs = 0;

    const sessionSummaries = sessions.map((s) => {
      const endedAt = s.endedAt ?? new Date();
      const grossMs = endedAt.getTime() - s.startedAt.getTime();
      const breakMs = s.breaks.reduce((sum, b) => {
        const bEnd = b.endedAt ?? new Date();
        return sum + (bEnd.getTime() - b.startedAt.getTime());
      }, 0);
      const netMs = Math.max(0, grossMs - breakMs);

      totalWorkedMs += netMs;
      totalBreakMs += breakMs;

      return {
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        netWorkedMinutes: Math.round(netMs / 60000),
        breakMinutes: Math.round(breakMs / 60000),
        breakCount: s.breaks.length,
        stillOpen: !s.endedAt,
      };
    });

    return {
      employeeId,
      employeeNumber: employee.employeeNumber,
      totalNetWorkedMinutes: Math.round(totalWorkedMs / 60000),
      totalBreakMinutes: Math.round(totalBreakMs / 60000),
      sessionCount: sessions.length,
      sessions: sessionSummaries,
    };
  }

  /**
   * Manager+ view of everyone's attendance and call volume for a date range —
   * scoped the same way CrmReportsService.teamPerformance is (org-wide for
   * Company Admin/Master Owner, reporting subtree otherwise), so a Manager
   * or Sales Head only ever sees their own team's attendance.
   */
  async teamReport(actor: AuthenticatedEmployee, from: Date, to: Date) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Team attendance is restricted to managers and above");
    }

    const employeeIds = await this.scope.authorizedEmployeeIds(actor);
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, employeeNumber: true, fullName: true, role: true, employmentStatus: true },
      orderBy: { fullName: "asc" },
    });

    const [sessions, callCounts] = await Promise.all([
      this.prisma.workSession.findMany({
        where: { employeeId: { in: employeeIds }, startedAt: { gte: from, lte: to } },
        include: { breaks: true },
      }),
      this.prisma.leadActivity.groupBy({
        by: ["actorId"],
        where: {
          actorId: { in: employeeIds },
          type: LeadActivityType.CALL,
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
      }),
    ]);

    const callsByEmployee = new Map(callCounts.map((c) => [c.actorId, c._count._all]));
    const sessionsByEmployee = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const bucket = sessionsByEmployee.get(session.employeeId);
      if (bucket) bucket.push(session);
      else sessionsByEmployee.set(session.employeeId, [session]);
    }

    return employees.map((employee) => {
      const empSessions = sessionsByEmployee.get(employee.id) ?? [];
      let workedMs = 0;
      let breakMs = 0;
      const presentDays = new Set<string>();

      for (const s of empSessions) {
        const endedAt = s.endedAt ?? new Date();
        const grossMs = endedAt.getTime() - s.startedAt.getTime();
        const sessionBreakMs = s.breaks.reduce((sum, b) => {
          const bEnd = b.endedAt ?? new Date();
          return sum + (bEnd.getTime() - b.startedAt.getTime());
        }, 0);
        workedMs += Math.max(0, grossMs - sessionBreakMs);
        breakMs += sessionBreakMs;
        presentDays.add(s.startedAt.toISOString().slice(0, 10));
      }

      return {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        role: employee.role,
        employmentStatus: employee.employmentStatus,
        daysPresent: presentDays.size,
        sessionCount: empSessions.length,
        totalNetWorkedMinutes: Math.round(workedMs / 60000),
        totalBreakMinutes: Math.round(breakMs / 60000),
        calls: callsByEmployee.get(employee.id) ?? 0,
      };
    });
  }
}
