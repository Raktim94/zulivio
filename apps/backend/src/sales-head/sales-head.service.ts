import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AssignmentStatus, LeadStatus, OpportunityStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isSalesHeadOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";
import { AttendanceService } from "../attendance/attendance.service";

const OPEN_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.IN_PROGRESS,
  AssignmentStatus.FOLLOW_UP,
  AssignmentStatus.BLOCKED,
];
const OPEN_LEAD_STATUSES: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED];

@Injectable()
export class SalesHeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeScope: EmployeeScopeService,
    private readonly attendance: AttendanceService,
  ) {}

  private assertSalesHead(actor: AuthenticatedEmployee) {
    if (!isSalesHeadOrAbove(actor.role)) {
      throw new ForbiddenException("Restricted to Sales Head and above");
    }
  }

  /** Directory of the actor's authorized scope, with open/overdue work counts joined in. */
  async employeeDirectory(actor: AuthenticatedEmployee) {
    this.assertSalesHead(actor);

    const scopeIds = await this.employeeScope.authorizedEmployeeIds(actor);
    const now = new Date();

    const [employees, assignmentCounts, overdueCounts, leadCounts, openOpportunities] = await Promise.all([
      this.prisma.employee.findMany({
        where: { organizationId: actor.organizationId, id: { in: scopeIds } },
        select: { id: true, employeeNumber: true, fullName: true, role: true, department: true, employmentStatus: true },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.assignment.groupBy({
        by: ["ownerId"],
        where: { organizationId: actor.organizationId, ownerId: { in: scopeIds }, status: { in: OPEN_ASSIGNMENT_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.assignment.groupBy({
        by: ["ownerId"],
        where: {
          organizationId: actor.organizationId,
          ownerId: { in: scopeIds },
          dueAt: { lt: now },
          status: { in: OPEN_ASSIGNMENT_STATUSES },
        },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ["ownerId"],
        where: { organizationId: actor.organizationId, ownerId: { in: scopeIds }, status: { in: OPEN_LEAD_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.opportunity.groupBy({
        by: ["ownerId"],
        where: { organizationId: actor.organizationId, ownerId: { in: scopeIds }, status: OpportunityStatus.OPEN },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ]);

    const byOwner = <T extends { ownerId: string | null }>(rows: T[]) =>
      new Map(rows.filter((r) => r.ownerId).map((r) => [r.ownerId as string, r]));

    const assignmentMap = byOwner(assignmentCounts);
    const overdueMap = byOwner(overdueCounts);
    const leadMap = byOwner(leadCounts);
    const opportunityMap = byOwner(openOpportunities);

    return employees.map((e) => ({
      ...e,
      openAssignments: assignmentMap.get(e.id)?._count._all ?? 0,
      overdueAssignments: overdueMap.get(e.id)?._count._all ?? 0,
      openLeads: leadMap.get(e.id)?._count._all ?? 0,
      openOpportunities: opportunityMap.get(e.id)?._count._all ?? 0,
      openPipelineValueMinor: opportunityMap.get(e.id)?._sum.amountMinor ?? 0,
    }));
  }

  /** One employee's full picture: profile, assignments, attendance, CRM activity, recent quality feedback. */
  async employeeDetail(actor: AuthenticatedEmployee, employeeId: string) {
    this.assertSalesHead(actor);

    if (!(await this.employeeScope.isInScope(actor, employeeId))) {
      throw new ForbiddenException("Target employee is outside your authorized scope");
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    const [assignments, leads, opportunities, qualityResults, attendanceState, recentAudit] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { organizationId: actor.organizationId, ownerId: employeeId },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.lead.findMany({
        where: { organizationId: actor.organizationId, ownerId: employeeId },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.opportunity.findMany({
        where: { organizationId: actor.organizationId, ownerId: employeeId },
        include: { stage: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.qualityAuditResult.findMany({
        where: { organizationId: actor.organizationId, employeeId, status: "PUBLISHED" },
        include: { definition: { select: { id: true, name: true } }, reviewer: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.attendance.currentStatus({ ...actor, id: employeeId }),
      this.prisma.auditEvent.findMany({
        where: { organizationId: actor.organizationId, targetId: employeeId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    return {
      employee,
      attendance: attendanceState,
      assignments,
      leads,
      opportunities,
      qualityResults,
      recentAudit,
    };
  }
}
