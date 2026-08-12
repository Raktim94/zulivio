import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { EmploymentStatus, Role } from "@prisma/client";

export interface AuthenticatedEmployee {
  id: string;
  organizationId: string;
  role: Role;
  fullName: string;
  email: string;
  employmentStatus: EmploymentStatus;
}

const SESSION_COOKIE = "ndcrm_session";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawToken: string | undefined = request.cookies?.[SESSION_COOKIE];

    if (!rawToken) {
      throw new UnauthorizedException("Not authenticated");
    }

    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { employee: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException("Session expired or invalid");
    }

    if (session.employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new UnauthorizedException("Employee is not active");
    }

    const employee: AuthenticatedEmployee = {
      id: session.employee.id,
      organizationId: session.employee.organizationId,
      role: session.employee.role,
      fullName: session.employee.fullName,
      email: session.employee.email,
      employmentStatus: session.employee.employmentStatus,
    };

    request.employee = employee;
    request.sessionId = session.id;
    return true;
  }
}

export { SESSION_COOKIE };
