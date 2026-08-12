import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AuthenticatedEmployee } from "./auth.guard";

/**
 * Roles form a strict hierarchy for authorization purposes:
 * MASTER_OWNER > COMPANY_ADMIN > SALES_HEAD > MANAGER > EMPLOYEE.
 * A route decorated with @Roles(Role.MANAGER) is satisfied by MANAGER
 * and everything above it, never below.
 */
const HIERARCHY: Role[] = [
  Role.EMPLOYEE,
  Role.MANAGER,
  Role.SALES_HEAD,
  Role.COMPANY_ADMIN,
  Role.MASTER_OWNER,
];

function rank(role: Role): number {
  return HIERARCHY.indexOf(role);
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const employee: AuthenticatedEmployee | undefined = request.employee;

    if (!employee) {
      throw new ForbiddenException("No authenticated employee on request");
    }

    const minimumRequired = Math.min(...required.map(rank));
    if (rank(employee.role) < minimumRequired) {
      throw new ForbiddenException("Insufficient role for this action");
    }

    return true;
  }
}
