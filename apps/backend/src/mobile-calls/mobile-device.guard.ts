import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { EmploymentStatus, MobileDeviceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { InMemoryRateLimiter } from "../common/rate-limiter";

// Bad-token attempts per client IP: stops token guessing without ever
// throttling a legitimate device (successful requests never count).
const FAILED_AUTH_LIMIT = new InMemoryRateLimiter(30, 60_000, "Too many failed authentication attempts.");

export const DEVICE_TOKEN_PREFIX = "zlm_";

/**
 * What a device token resolves to. organizationId and employeeId come from
 * the database row the token points at — never from the request body.
 */
export interface AuthenticatedDevice {
  id: string;
  deviceKey: string;
  name: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
}

export function hashDeviceToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Bearer-token auth for phones. Routes using it are marked @Public() so the
 * global employee AuthGuard (which would treat the bearer as a personal API
 * key) steps aside; this guard is then the only gate. Checks, in order:
 * token known -> device ACTIVE -> owning employee ACTIVE and in the same
 * organization as the device.
 */
@Injectable()
export class MobileDeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const reject = (): never => {
      FAILED_AUTH_LIMIT.assert(request.ip ?? "unknown");
      throw new UnauthorizedException("Missing or invalid device token");
    };
    if (!raw || !raw.startsWith(DEVICE_TOKEN_PREFIX) || raw.length > 128) return reject();

    const device = await this.prisma.mobileDevice.findUnique({
      where: { tokenHash: hashDeviceToken(raw) },
      include: { employee: true },
    });
    if (!device) return reject();

    if (device.status !== MobileDeviceStatus.ACTIVE) {
      throw new ForbiddenException("This device has been disabled");
    }
    if (
      device.employee.employmentStatus !== EmploymentStatus.ACTIVE ||
      device.employee.organizationId !== device.organizationId
    ) {
      throw new ForbiddenException("The employee assigned to this device is not authorized");
    }

    request.mobileDevice = {
      id: device.id,
      deviceKey: device.deviceKey,
      name: device.name,
      organizationId: device.organizationId,
      employeeId: device.employeeId,
      employeeName: device.employee.fullName,
    };
    return true;
  }
}
