import { HttpStatus, Injectable } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { EmploymentStatus, MobileAuthTokenKind, MobileDeviceStatus, type Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import {
  MOBILE_ACCESS_PREFIX,
  MOBILE_ACCESS_TTL_MS,
  MOBILE_REFRESH_PREFIX,
  MOBILE_REFRESH_TTL_MS,
  hashMobileToken,
  newMobileToken,
} from "../common/mobile-token";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { mobileError } from "../mobile-calls/mobile-api-error.filter";
import { PrismaService } from "../prisma/prisma.service";
import type { DeviceInfoDto } from "./dto";

// Per client IP, on top of AuthService's per-email limiter.
const LOGIN_IP_LIMIT = new InMemoryRateLimiter(40, 15 * 60_000, "Too many sign-in attempts from this network. Try again later.");
const REFRESH_LIMIT = new InMemoryRateLimiter(60, 60_000, "Too many refresh attempts. Try again in a minute.");

@Injectable()
export class MobileAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async audit(organizationId: string, actorId: string | null, action: string, targetId: string, metadata: Prisma.InputJsonObject = {}) {
    await this.prisma.auditEvent
      .create({
        data: { organizationId, actorId, action, targetType: "MobileDevice", targetId, metadata },
      })
      .catch(() => undefined);
  }

  /** Mints an access + refresh pair in one family and stores only their hashes. */
  private async issue(deviceId: string, employeeId: string, familyId: string) {
    const access = newMobileToken(MOBILE_ACCESS_PREFIX);
    const refresh = newMobileToken(MOBILE_REFRESH_PREFIX);
    const now = Date.now();
    const accessExpiresAt = new Date(now + MOBILE_ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now + MOBILE_REFRESH_TTL_MS);
    await this.prisma.mobileAuthToken.createMany({
      data: [
        { deviceId, employeeId, kind: MobileAuthTokenKind.ACCESS, tokenHash: access.hash, familyId, expiresAt: accessExpiresAt },
        { deviceId, employeeId, kind: MobileAuthTokenKind.REFRESH, tokenHash: refresh.hash, familyId, expiresAt: refreshExpiresAt },
      ],
    });
    return {
      accessToken: access.raw,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: refresh.raw,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  async login(email: string, password: string, info: DeviceInfoDto, ip: string) {
    LOGIN_IP_LIMIT.assert(ip);
    const employee = await this.auth.verifyCredentials(email, password);

    // One device row per (installation, employee): switching accounts on the
    // same phone gives each account its own revocable device.
    const deviceKey = `app-${info.installId.slice(0, 24)}-${employee.id.slice(0, 8)}`;
    let device = await this.prisma.mobileDevice.findUnique({
      where: { organizationId_deviceKey: { organizationId: employee.organizationId, deviceKey } },
    });
    if (device && device.status !== MobileDeviceStatus.ACTIVE) {
      throw mobileError(HttpStatus.FORBIDDEN, "DEVICE_DISABLED", "This device has been disabled by an administrator.");
    }
    if (device) {
      device = await this.prisma.mobileDevice.update({
        where: { id: device.id },
        data: { name: info.name, platform: info.platform ?? null, appVersion: info.appVersion ?? null, lastSeenAt: new Date() },
      });
    } else {
      device = await this.prisma.mobileDevice.create({
        data: {
          organizationId: employee.organizationId,
          employeeId: employee.id,
          deviceKey,
          name: info.name,
          enrollment: "APP",
          platform: info.platform ?? null,
          appVersion: info.appVersion ?? null,
          // An unguessable placeholder: app devices have no static token.
          tokenHash: hashMobileToken(randomBytes(32).toString("hex")),
          tokenLastFour: "----",
          createdById: employee.id,
          lastSeenAt: new Date(),
        },
      });
      await this.audit(employee.organizationId, employee.id, "mobile.device_enrolled", device.id, { name: info.name, platform: info.platform ?? null });
    }
    const tokens = await this.issue(device.id, employee.id, randomUUID());
    await this.audit(employee.organizationId, employee.id, "mobile.login", device.id);
    const org = await this.prisma.organization.findUnique({ where: { id: employee.organizationId }, select: { name: true } });
    return {
      ...tokens,
      device: { id: device.id, name: device.name },
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        mustChangePassword: employee.mustChangePassword,
      },
      organization: { name: org?.name ?? "" },
      serverTime: new Date().toISOString(),
    };
  }

  async refresh(rawRefresh: string, ip: string) {
    REFRESH_LIMIT.assert(ip);
    const invalid = () => mobileError(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "Session expired. Please sign in again.");
    if (!rawRefresh.startsWith(MOBILE_REFRESH_PREFIX)) throw invalid();

    const token = await this.prisma.mobileAuthToken.findUnique({
      where: { tokenHash: hashMobileToken(rawRefresh) },
      include: { device: { include: { employee: true } } },
    });
    if (!token || token.kind !== MobileAuthTokenKind.REFRESH || token.revokedAt || token.expiresAt.getTime() < Date.now()) throw invalid();

    const { device } = token;
    if (device.status !== MobileDeviceStatus.ACTIVE) {
      throw mobileError(HttpStatus.FORBIDDEN, "DEVICE_DISABLED", "This device has been disabled by an administrator.");
    }
    if (device.employee.employmentStatus !== EmploymentStatus.ACTIVE) throw invalid();

    // Single use. updateMany is the atomic claim: if two requests race with
    // the same token only one sees count === 1.
    const claimed = await this.prisma.mobileAuthToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // A refresh token was replayed: either the phone or an attacker holds a
      // stale copy. Burn the whole family so neither can continue.
      await this.prisma.mobileAuthToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(device.organizationId, device.employeeId, "mobile.refresh_reuse_detected", device.id, { familyId: token.familyId });
      throw mobileError(HttpStatus.UNAUTHORIZED, "TOKEN_REUSED", "Session was invalidated for your safety. Please sign in again.");
    }

    await this.prisma.mobileAuthToken.updateMany({
      where: { familyId: token.familyId, kind: MobileAuthTokenKind.ACCESS, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issue(device.id, device.employeeId, token.familyId);
    await this.prisma.mobileDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { ...tokens, serverTime: new Date().toISOString() };
  }

  async logout(deviceId: string, organizationId: string, employeeId: string, familyId: string | undefined, purgeContacts: boolean) {
    await this.prisma.mobileAuthToken.updateMany({
      where: familyId ? { familyId, revokedAt: null } : { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    let purged = 0;
    if (purgeContacts) {
      purged = (await this.prisma.mobileContact.deleteMany({ where: { organizationId, deviceId } })).count;
    }
    await this.audit(organizationId, employeeId, "mobile.logout", deviceId, { purgedContacts: purged });
    return { ok: true, purgedContacts: purged };
  }

  async me(deviceId: string) {
    const device = await this.prisma.mobileDevice.findUniqueOrThrow({ where: { id: deviceId }, include: { employee: true, organization: { select: { name: true } } } });
    return {
      device: { id: device.id, name: device.name, status: device.status },
      employee: {
        id: device.employee.id,
        fullName: device.employee.fullName,
        email: device.employee.email,
        role: device.employee.role,
        mustChangePassword: device.employee.mustChangePassword,
      },
      organization: { name: device.organization.name },
      serverTime: new Date().toISOString(),
    };
  }
}
