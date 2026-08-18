import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { EmploymentStatus, Role } from "@prisma/client";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();

    const bearerToken = this.extractBearerToken(request);
    if (bearerToken) {
      return this.authenticateApiKey(request, bearerToken);
    }

    const rawToken = request.cookies?.[SESSION_COOKIE] as string | undefined;
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

    request.employee = this.toAuthenticatedEmployee(session.employee);
    request.sessionId = session.id;
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length).trim() || null;
  }

  /**
   * Personal access tokens (see ApiKey in schema.prisma) — a key carries no
   * permissions of its own, it just resolves to its owning employee, so
   * every existing role/RBAC/scope check downstream applies exactly as if
   * that employee were logged in via a browser session. Used by the MCP
   * server (mcp/) and any other programmatic client.
   */
  private async authenticateApiKey(request: Request, rawToken: string): Promise<boolean> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { tokenHash },
      include: { employee: true },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException("Invalid or revoked API key");
    }

    if (apiKey.employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new UnauthorizedException("Employee is not active");
    }

    request.employee = this.toAuthenticatedEmployee(apiKey.employee);
    request.apiKeyId = apiKey.id;

    // Best-effort — an update failure here must never block the request
    // that's already been authenticated.
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }

  private toAuthenticatedEmployee(employee: {
    id: string;
    organizationId: string;
    role: Role;
    fullName: string;
    email: string;
    employmentStatus: EmploymentStatus;
  }): AuthenticatedEmployee {
    return {
      id: employee.id,
      organizationId: employee.organizationId,
      role: employee.role,
      fullName: employee.fullName,
      email: employee.email,
      employmentStatus: employee.employmentStatus,
    };
  }
}

export { SESSION_COOKIE };
