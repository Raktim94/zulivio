import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AuthenticatedEmployee } from "./auth.guard";
import { rank } from "../roles";

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

    const request: Request = context.switchToHttp().getRequest();
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
