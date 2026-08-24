import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { EmployeeScopeService } from "../common/scope.service";

/**
 * Single place that answers "which leads may this actor see or act on".
 *
 * Before the telecalling CRM work, leads.service.ts gated on
 * `isManagerOrAbove` — so any line manager could read and reassign every
 * other team's leads org-wide. That is the exact blanket-visibility problem
 * EmployeeScopeService was introduced to fix for assignments and reports
 * (see its doc comment); this brings leads onto the same org-chart scoping:
 *
 *   EMPLOYEE                     self only (owned or created)
 *   MANAGER                      self + direct reports
 *   SALES_HEAD                   self + full reporting subtree
 *   COMPANY_ADMIN / MASTER_OWNER whole organization
 *
 * Admins keep org-wide access, so this narrows nobody who is supposed to
 * see everything. Unassigned leads stay visible to Manager+ — otherwise a
 * lead nobody owns yet would be invisible to the very people who assign it.
 */
@Injectable()
export class LeadAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: EmployeeScopeService,
  ) {}

  /** True when the actor sees the whole org and needs no owner filter at all. */
  isOrgWide(actor: AuthenticatedEmployee): boolean {
    return actor.role === Role.MASTER_OWNER || actor.role === Role.COMPANY_ADMIN;
  }

  /**
   * A `where` fragment to spread into any lead query. Returns `{}` for
   * org-wide roles so the query planner isn't handed a pointless `IN` over
   * every employee id in the organization.
   */
  async leadScopeWhere(actor: AuthenticatedEmployee): Promise<Prisma.LeadWhereInput> {
    if (this.isOrgWide(actor)) return {};

    const authorized = await this.scope.authorizedEmployeeIds(actor);

    if (actor.role === Role.EMPLOYEE) {
      return { OR: [{ ownerId: actor.id }, { createdById: actor.id }] };
    }

    return {
      OR: [
        { ownerId: { in: authorized } },
        { createdById: { in: authorized } },
        // Nobody owns it yet — a manager must be able to see it to route it.
        { ownerId: null },
      ],
    };
  }

  /** Loads a lead the actor is allowed to see, or throws the right error. */
  async findScopedLead(actor: AuthenticatedEmployee, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId: actor.organizationId },
    });
    // 404 rather than 403 across organizations: confirming a foreign id
    // exists is itself a cross-tenant leak.
    if (!lead) throw new NotFoundException("Lead not found");

    if (this.isOrgWide(actor)) return lead;

    if (actor.role === Role.EMPLOYEE) {
      if (lead.ownerId !== actor.id && lead.createdById !== actor.id) {
        throw new ForbiddenException("Not authorized to view this lead");
      }
      return lead;
    }

    const authorized = await this.scope.authorizedEmployeeIds(actor);
    const visible =
      lead.ownerId === null ||
      (lead.ownerId !== null && authorized.includes(lead.ownerId)) ||
      authorized.includes(lead.createdById);

    if (!visible) throw new ForbiddenException("Not authorized to view this lead");
    return lead;
  }

  /**
   * Validates a proposed owner: must be in the same org, and — for a
   * manager — inside their own scope, so reassignment can't be used to push
   * a lead onto someone else's team or pull one off it.
   */
  async assertAssignableOwner(actor: AuthenticatedEmployee, ownerId: string) {
    const owner = await this.prisma.employee.findFirst({
      where: { id: ownerId, organizationId: actor.organizationId },
      select: { id: true },
    });
    // Message kept byte-identical to what this endpoint already returned.
    if (!owner) throw new BadRequestException("ownerId does not belong to this organization");

    if (this.isOrgWide(actor)) return;

    const authorized = await this.scope.authorizedEmployeeIds(actor);
    if (!authorized.includes(ownerId)) {
      throw new ForbiddenException("Not authorized to assign leads to that employee");
    }
  }
}
