import { CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { EmploymentStatus } from "@prisma/client";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { mobileError } from "../mobile-calls/mobile-api-error.filter";
import { PrismaService } from "../prisma/prisma.service";
import { CREDENTIAL_PREFIX, hashCredential } from "./credentials.service";

export const SCOPE_KEY = "ext_scope";
/** Declares the scope an /ext route needs. A route with no scope is refused, so a forgotten decorator fails closed. */
export const RequireScope = (scope: string) => SetMetadata(SCOPE_KEY, scope);

// Per credential, not per IP: an integration usually runs from one server address shared with many others.
const RATE = new InMemoryRateLimiter(600, 60_000, "Rate limit exceeded (600 requests per minute). Retry in a minute.");
const FAILED_AUTH = new InMemoryRateLimiter(60, 60_000, "Too many failed authentication attempts.");

@Injectable()
export class IntegrationAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader("X-Request-Id", (req.headers["x-request-id"] as string | undefined)?.slice(0, 64) ?? randomUUID());

    const header = req.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const reject = (): never => {
      FAILED_AUTH.assert(req.ip ?? "unknown");
      throw mobileError(401, "INVALID_CREDENTIAL", "Missing, invalid, expired or revoked API credential.");
    };
    if (!raw.startsWith(CREDENTIAL_PREFIX) || raw.length > 128) return reject();

    const cred = await this.prisma.integrationCredential.findUnique({ where: { tokenHash: hashCredential(raw) } });
    if (!cred || cred.revokedAt || (cred.expiresAt && cred.expiresAt.getTime() < Date.now())) return reject();
    // A credential is only as alive as the person accountable for it.
    const owner = await this.prisma.employee.findFirst({ where: { id: cred.createdById, organizationId: cred.organizationId }, select: { id: true, employmentStatus: true } });
    if (!owner || owner.employmentStatus !== EmploymentStatus.ACTIVE) return reject();

    try {
      RATE.assert(cred.id);
    } catch (e) {
      if (e instanceof HttpException) res.setHeader("Retry-After", "60");
      throw e;
    }

    const required = this.reflector.get<string | undefined>(SCOPE_KEY, ctx.getHandler());
    if (!required || !cred.scopes.includes(required)) {
      throw mobileError(403, "INSUFFICIENT_SCOPE", required ? `This credential lacks the "${required}" scope.` : "This endpoint is not available to API credentials.");
    }

    if (!cred.lastUsedAt || Date.now() - cred.lastUsedAt.getTime() > 60_000) {
      void this.prisma.integrationCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    req.integrationCredential = { id: cred.id, organizationId: cred.organizationId, scopes: cred.scopes, createdById: cred.createdById, name: cred.name };
    return true;
  }
}
