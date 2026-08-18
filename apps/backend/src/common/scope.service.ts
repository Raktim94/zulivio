import { Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "./guards/auth.guard";
import { isSalesHeadOrAbove } from "./roles";

/**
 * Resolves the set of employee IDs an actor is authorized to see/manage for
 * CRM and reporting purposes (assignments, leads, opportunities, sales
 * dashboard, reports). This is distinct from — and narrower than — the
 * general employee-directory visibility in employees.service.ts (which
 * stays rank-based: any Manager+ can administratively see every
 * lower-ranked employee org-wide, for HR-type actions like reset-password).
 *
 * CRM/reporting scope is org-chart-based instead:
 *   EMPLOYEE:      self only.
 *   MANAGER:       self + direct reports (one level, managerId === actor.id).
 *   SALES_HEAD:    self + the full reporting subtree beneath them (recursive)
 *                  — they run the whole sales org, not just one team.
 *   COMPANY_ADMIN / MASTER_OWNER: every employee in the organization.
 *
 * Before this, SALES_HEAD had no behavior distinct from MANAGER anywhere in
 * the backend, and org-wide CRM views (e.g. the sales dashboard) were
 * unscoped for every Manager+, letting one team's manager see every other
 * team's pipeline/revenue data.
 */
@Injectable()
export class EmployeeScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async authorizedEmployeeIds(actor: AuthenticatedEmployee): Promise<string[]> {
    if (actor.role === Role.MASTER_OWNER || actor.role === Role.COMPANY_ADMIN) {
      const all = await this.prisma.employee.findMany({
        where: { organizationId: actor.organizationId },
        select: { id: true },
      });
      return all.map((e) => e.id);
    }

    if (isSalesHeadOrAbove(actor.role)) {
      // isSalesHeadOrAbove is only reached here for exactly SALES_HEAD,
      // since MASTER_OWNER/COMPANY_ADMIN already returned above.
      return this.recursiveSubtreeIds(actor.id, actor.organizationId);
    }

    if (actor.role === Role.MANAGER) {
      const directReports = await this.prisma.employee.findMany({
        where: { organizationId: actor.organizationId, managerId: actor.id },
        select: { id: true },
      });
      return [actor.id, ...directReports.map((e) => e.id)];
    }

    return [actor.id];
  }

  async isInScope(actor: AuthenticatedEmployee, employeeId: string): Promise<boolean> {
    if (employeeId === actor.id) return true;
    const scope = await this.authorizedEmployeeIds(actor);
    return scope.includes(employeeId);
  }

  /** BFS down the managerId self-relation, one query per level, org-scoped throughout. */
  private async recursiveSubtreeIds(rootId: string, organizationId: string): Promise<string[]> {
    const seen = new Set<string>([rootId]);
    let frontier = [rootId];

    while (frontier.length > 0) {
      const children = await this.prisma.employee.findMany({
        where: { organizationId, managerId: { in: frontier } },
        select: { id: true },
      });
      frontier = [];
      for (const child of children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          frontier.push(child.id);
        }
      }
    }

    return Array.from(seen);
  }
}
