import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { EmploymentStatus, MobileAuthTokenKind, MobileDeviceStatus, Role } from "@prisma/client";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { MOBILE_ACCESS_PREFIX, hashMobileToken } from "../mobile-token";
import { isMobileRouteAllowed } from "../mobile-scope";

export interface AuthenticatedEmployee {
  id: string;
  organizationId: string;
  role: Role;
  fullName: string;
  email: string;
  employmentStatus: EmploymentStatus;
  mustChangePassword: boolean;
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
    if (bearerToken?.startsWith(MOBILE_ACCESS_PREFIX)) {
      return this.authenticateMobile(request, bearerToken);
    }
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

  /**
   * Access token of a signed-in Android app installation. Resolves to the
   * owning employee exactly like a browser session (all role / ownership
   * checks downstream apply), but is additionally confined to the mobile
   * route allowlist and dies the moment the token, device, or employee is
   * revoked/disabled — it is looked up on every request.
   */
  private async authenticateMobile(request: Request, rawToken: string): Promise<boolean> {
    const token = await this.prisma.mobileAuthToken.findUnique({
      where: { tokenHash: hashMobileToken(rawToken) },
      include: { device: { include: { employee: true } } },
    });
    if (
      !token ||
      token.kind !== MobileAuthTokenKind.ACCESS ||
      token.revokedAt ||
      token.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException("Session expired or invalid");
    }
    const { device } = token;
    if (device.status !== MobileDeviceStatus.ACTIVE) {
      throw new UnauthorizedException("This device has been disabled");
    }
    if (
      device.employee.employmentStatus !== EmploymentStatus.ACTIVE ||
      device.employee.organizationId !== device.organizationId
    ) {
      throw new UnauthorizedException("Employee is not active");
    }
    if (!isMobileRouteAllowed(request.method, request.path)) {
      throw new ForbiddenException("This endpoint is not available to the mobile app");
    }
    request.employee = this.toAuthenticatedEmployee(device.employee);
    request.mobileAuth = { deviceId: device.id, tokenId: token.id, familyId: token.familyId };
    return true;
  }

  private toAuthenticatedEmployee(employee: {
    id: string;
    organizationId: string;
    role: Role;
    fullName: string;
    email: string;
    employmentStatus: EmploymentStatus;
    mustChangePassword: boolean;
  }): AuthenticatedEmployee {
    return {
      id: employee.id,
      organizationId: employee.organizationId,
      role: employee.role,
      fullName: employee.fullName,
      email: employee.email,
      employmentStatus: employee.employmentStatus,
      mustChangePassword: employee.mustChangePassword,
    };
  }
}

export { SESSION_COOKIE };
