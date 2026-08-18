import { Role } from "@prisma/client";

/**
 * Roles form a strict hierarchy for authorization purposes:
 * MASTER_OWNER > COMPANY_ADMIN > SALES_HEAD > MANAGER > EMPLOYEE.
 *
 * This is the single source of truth for rank comparisons — previously this
 * ordering was duplicated independently in roles.guard.ts, employees.service.ts,
 * and as a copy-pasted `MANAGER_RANK` constant in 9 other services, which had
 * drifted into three different visibility semantics. Import from here instead
 * of re-declaring it.
 */
export const ROLE_HIERARCHY: Role[] = [
  Role.EMPLOYEE,
  Role.MANAGER,
  Role.SALES_HEAD,
  Role.COMPANY_ADMIN,
  Role.MASTER_OWNER,
];

export function rank(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role);
}

export function hasMinimumRank(role: Role, minimum: Role): boolean {
  return rank(role) >= rank(minimum);
}

/** Roles strictly below the given role, per ROLE_HIERARCHY order. */
export function rolesBelow(role: Role): Role[] {
  return ROLE_HIERARCHY.slice(0, rank(role));
}

/**
 * True for MANAGER and every rank above it — the historical "manager or
 * above" gate used throughout the CRM/assignment/attendance/reports modules.
 * Kept as a named export (rather than an inline rank comparison) so call
 * sites read the same way they did before this consolidation.
 */
export function isManagerOrAbove(role: Role): boolean {
  return hasMinimumRank(role, Role.MANAGER);
}

/**
 * True for SALES_HEAD and above. Distinguishes "runs the whole sales org"
 * (Sales Head/Admin/Owner — org-wide sales visibility) from a line MANAGER,
 * who from this pass onward is scoped to their own reporting subtree for
 * CRM/assignment records (see EmployeeScopeService). Before this change,
 * SALES_HEAD had no behavior distinct from MANAGER anywhere in the backend.
 */
export function isSalesHeadOrAbove(role: Role): boolean {
  return hasMinimumRank(role, Role.SALES_HEAD);
}
