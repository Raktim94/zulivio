import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EmploymentStatus, MobileDeviceStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { DEVICE_TOKEN_PREFIX, hashDeviceToken } from "./mobile-device.guard";
import { cleanText } from "./mobile-call.validation";

const MAX_DEVICES_PER_ORG = 500;

const deviceInclude = {
  employee: { select: { id: true, fullName: true, employeeNumber: true } },
} satisfies Prisma.MobileDeviceInclude;

type DeviceRow = Prisma.MobileDeviceGetPayload<{ include: typeof deviceInclude }>;

function present(d: DeviceRow, callCount?: number) {
  return {
    id: d.id,
    deviceId: d.deviceKey,
    name: d.name,
    phoneNumber: d.phoneNumber,
    status: d.status,
    employee: d.employee,
    tokenLastFour: d.tokenLastFour,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    lastTestAt: d.lastTestAt,
    lastSyncAt: d.lastSyncAt,
    lastExternalCallId: d.lastExternalCallId,
    ...(callCount === undefined ? {} : { callCount }),
  };
}

function newToken() {
  const raw = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashDeviceToken(raw), lastFour: raw.slice(-4) };
}

export interface CreateDeviceInput {
  deviceId: string;
  name: string;
  employeeId: string;
  phoneNumber?: string;
}

/** Administration of registered phones. Every query carries organizationId from the actor. */
@Injectable()
export class MobileDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(actor: AuthenticatedEmployee, action: string, targetId: string, metadata?: Prisma.InputJsonValue) {
    return this.prisma.auditEvent.create({
      data: { organizationId: actor.organizationId, actorId: actor.id, action, targetType: "MobileDevice", targetId, metadata },
    });
  }

  private async mustFind(actor: AuthenticatedEmployee, id: string) {
    const device = await this.prisma.mobileDevice.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: deviceInclude,
    });
    if (!device) throw new NotFoundException("Device not found");
    return device;
  }

  private async assertAssignable(actor: AuthenticatedEmployee, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });
    if (!employee) throw new NotFoundException("Employee not found in this organization");
    if (employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new BadRequestException("Cannot assign a device to an employee who is not active");
    }
  }

  async list(actor: AuthenticatedEmployee) {
    const devices = await this.prisma.mobileDevice.findMany({
      where: { organizationId: actor.organizationId },
      include: deviceInclude,
      orderBy: { createdAt: "desc" },
      take: MAX_DEVICES_PER_ORG,
    });
    const counts = await this.prisma.mobileCall.groupBy({
      by: ["deviceId"],
      where: { organizationId: actor.organizationId },
      _count: { _all: true },
    });
    const byDevice = new Map(counts.map((c) => [c.deviceId, c._count._all]));
    return devices.map((d) => present(d, byDevice.get(d.id) ?? 0));
  }

  async get(actor: AuthenticatedEmployee, id: string) {
    return present(await this.mustFind(actor, id));
  }

  async create(actor: AuthenticatedEmployee, input: CreateDeviceInput) {
    await this.assertAssignable(actor, input.employeeId);
    const total = await this.prisma.mobileDevice.count({ where: { organizationId: actor.organizationId } });
    if (total >= MAX_DEVICES_PER_ORG) throw new BadRequestException("Device limit reached for this organization");

    const { raw, hash, lastFour } = newToken();
    try {
      const device = await this.prisma.mobileDevice.create({
        data: {
          organizationId: actor.organizationId,
          employeeId: input.employeeId,
          deviceKey: input.deviceId,
          name: cleanText(input.name, 80),
          phoneNumber: input.phoneNumber ? cleanText(input.phoneNumber, 32) : null,
          tokenHash: hash,
          tokenLastFour: lastFour,
          createdById: actor.id,
        },
        include: deviceInclude,
      });
      await this.audit(actor, "mobile_device.created", device.id, { deviceId: device.deviceKey, employeeId: input.employeeId });
      await this.audit(actor, "mobile_device.token_generated", device.id);
      // The one and only time the raw token exists outside the phone.
      return { ...present(device), token: raw };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A device with this device ID already exists");
      }
      throw err;
    }
  }

  async update(actor: AuthenticatedEmployee, id: string, input: { name?: string; employeeId?: string; phoneNumber?: string | null }) {
    await this.mustFind(actor, id);
    if (input.employeeId) await this.assertAssignable(actor, input.employeeId);
    const device = await this.prisma.mobileDevice.update({
      where: { id },
      data: {
        name: input.name ? cleanText(input.name, 80) : undefined,
        employeeId: input.employeeId,
        phoneNumber: input.phoneNumber === undefined ? undefined : input.phoneNumber ? cleanText(input.phoneNumber, 32) : null,
      },
      include: deviceInclude,
    });
    await this.audit(actor, "mobile_device.updated", id, { employeeId: input.employeeId ?? null });
    return present(device);
  }

  async regenerateToken(actor: AuthenticatedEmployee, id: string) {
    await this.mustFind(actor, id);
    const { raw, hash, lastFour } = newToken();
    // Replacing the hash invalidates the previous token immediately.
    const device = await this.prisma.mobileDevice.update({
      where: { id },
      data: { tokenHash: hash, tokenLastFour: lastFour, tokenRotatedAt: new Date() },
      include: deviceInclude,
    });
    await this.audit(actor, "mobile_device.token_regenerated", id);
    return { ...present(device), token: raw };
  }

  async setStatus(actor: AuthenticatedEmployee, id: string, status: MobileDeviceStatus) {
    await this.mustFind(actor, id);
    const device = await this.prisma.mobileDevice.update({ where: { id }, data: { status }, include: deviceInclude });
    await this.audit(actor, status === MobileDeviceStatus.DISABLED ? "mobile_device.disabled" : "mobile_device.enabled", id);
    return present(device);
  }

  /** Removes the device, its token and — by FK cascade — every call it ever synced. */
  async remove(actor: AuthenticatedEmployee, id: string) {
    const device = await this.mustFind(actor, id);
    const calls = await this.prisma.mobileCall.count({ where: { organizationId: actor.organizationId, deviceId: id } });
    await this.prisma.$transaction([
      this.prisma.mobileCall.deleteMany({ where: { organizationId: actor.organizationId, deviceId: id } }),
      this.prisma.mobileDevice.delete({ where: { id } }),
    ]);
    await this.audit(actor, "mobile_device.removed", id, { deviceId: device.deviceKey, callsDeleted: calls });
    return { ok: true, callsDeleted: calls };
  }

  async clearCalls(actor: AuthenticatedEmployee, id: string) {
    await this.mustFind(actor, id);
    const { count } = await this.prisma.mobileCall.deleteMany({ where: { organizationId: actor.organizationId, deviceId: id } });
    await this.audit(actor, "mobile_calls.deleted", id, { scope: "device", count });
    return { ok: true, deleted: count };
  }
}
