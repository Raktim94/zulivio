import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_BULK_CALLS } from "./mobile-call.validation";
import { MobileApiExceptionFilter, mobileError } from "./mobile-api-error.filter";
import { MobileDeviceGuard, type AuthenticatedDevice } from "./mobile-device.guard";
import { MobileCallsService } from "./mobile-calls.service";

// Per authenticated device (not per IP: a phone's carrier-NAT address is shared).
const SINGLE_LIMIT = new InMemoryRateLimiter(120, 60_000, "Rate limit exceeded. Retry in a minute.");
const BULK_LIMIT = new InMemoryRateLimiter(20, 60_000, "Rate limit exceeded. Retry in a minute.");
const LARGE_IMPORT = 200;

interface DeviceRequest extends Request {
  mobileDevice: AuthenticatedDevice;
}

/**
 * Phone-facing API. @Public() only opts out of the employee-session
 * AuthGuard; MobileDeviceGuard is the real gate and is mandatory here.
 * The organization and employee are taken from the device row the token
 * resolves to — any organization_id / employee_id in the body is ignored
 * (unknown fields are never read).
 */
@Public()
@UseGuards(MobileDeviceGuard)
@UseFilters(MobileApiExceptionFilter)
@Controller("api/v1/mobile")
export class MobileIngestController {
  constructor(
    private readonly calls: MobileCallsService,
    private readonly prisma: PrismaService,
  ) {}

  private assertDeviceId(device: AuthenticatedDevice, supplied: unknown) {
    if (supplied !== undefined && supplied !== null && supplied !== device.deviceKey) {
      throw mobileError(
        HttpStatus.FORBIDDEN,
        "DEVICE_MISMATCH",
        "device_id does not match the device this token was issued for.",
      );
    }
  }

  private body(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw mobileError(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Request body must be a JSON object.");
    }
    return raw as Record<string, unknown>;
  }

  @Post("calls")
  async single(@Req() req: DeviceRequest, @Res({ passthrough: true }) res: Response, @Body() raw: unknown) {
    const device = req.mobileDevice;
    SINGLE_LIMIT.assert(device.id);
    const body = this.body(raw);
    this.assertDeviceId(device, body.device_id);

    const call = { ...body };
    delete call.device_id;
    const summary = await this.calls.ingest(device, [call], "api", new Date());
    const item = summary.results[0];

    if (item.status === "rejected") {
      throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, item.code ?? "VALIDATION_FAILED", item.message ?? "Invalid call.");
    }
    if (item.status === "failed") {
      throw mobileError(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "The call could not be stored. Retry later.");
    }

    await this.calls.touchDevice(device.id, { sync: true, lastExternalCallId: summary.lastExternalCallId });
    const created = item.status === "created";
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { success: true, status: item.status, duplicate: !created };
  }

  @Post("calls/bulk")
  @HttpCode(HttpStatus.OK)
  async bulk(@Req() req: DeviceRequest, @Body() raw: unknown) {
    const device = req.mobileDevice;
    BULK_LIMIT.assert(device.id);
    const body = this.body(raw);
    this.assertDeviceId(device, body.device_id);

    if (!Array.isArray(body.calls)) {
      throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_CALLS", "calls must be an array.");
    }
    if (body.calls.length === 0) {
      throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_CALLS", "calls must not be empty.");
    }
    if (body.calls.length > MAX_BULK_CALLS) {
      await this.audit(device, "mobile.sync_rejected", { received: body.calls.length, max: MAX_BULK_CALLS });
      throw mobileError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "BATCH_TOO_LARGE",
        `A bulk upload may contain at most ${MAX_BULK_CALLS} calls; split it into batches.`,
      );
    }

    const summary = await this.calls.ingest(device, body.calls, "api");
    await this.calls.touchDevice(device.id, { sync: true, lastExternalCallId: summary.lastExternalCallId });
    await this.audit(device, summary.received >= LARGE_IMPORT ? "mobile.sync_large" : "mobile.sync", {
      received: summary.received,
      created: summary.created,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      failed: summary.failed,
    });

    return {
      success: summary.failed === 0,
      received: summary.received,
      created: summary.created,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      failed: summary.failed,
      last_external_call_id: summary.lastExternalCallId,
      // Everything that was not stored, so the client can fix or retry it;
      // successfully created/duplicate rows need no follow-up.
      errors: summary.results
        .filter((r) => r.status === "rejected" || r.status === "failed")
        .slice(0, 100)
        .map((r) => ({ index: r.index, status: r.status, code: r.code, message: r.message })),
    };
  }

  /**
   * Connection check for the setup wizard / MacroDroid test button. Records
   * the device as seen, stores nothing in the call table, and so never
   * affects call statistics.
   */
  @Post("devices/test")
  @HttpCode(HttpStatus.OK)
  async test(@Req() req: DeviceRequest, @Body() raw: unknown) {
    const device = req.mobileDevice;
    SINGLE_LIMIT.assert(device.id);
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      this.assertDeviceId(device, (raw as Record<string, unknown>).device_id);
    }
    await this.calls.touchDevice(device.id, { test: true });
    return {
      success: true,
      message: "Connected successfully",
      device: { id: device.deviceKey, name: device.name },
      employee: device.employeeName,
      server_time: new Date().toISOString(),
    };
  }

  private audit(device: AuthenticatedDevice, action: string, metadata: Record<string, number>) {
    return this.prisma.auditEvent
      .create({
        data: {
          organizationId: device.organizationId,
          actorId: device.employeeId,
          action,
          targetType: "MobileDevice",
          targetId: device.id,
          metadata,
        },
      })
      .catch(() => undefined);
  }
}
