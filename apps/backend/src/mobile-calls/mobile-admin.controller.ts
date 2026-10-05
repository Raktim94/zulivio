import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthGuard, type AuthenticatedEmployee } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttachLeadDto,
  CreateDeviceDto,
  CreateLeadFromCallDto,
  DeleteCallsQuery,
  ImportCallsDto,
  ListCallsQuery,
  RetentionDto,
  SetDeviceStatusDto,
  SummaryQuery,
  UpdateDeviceDto,
} from "./dto";
import { MobileCallsQueryService } from "./mobile-calls-query.service";
import { MobileCallsService } from "./mobile-calls.service";
import { MobileDevicesService } from "./mobile-devices.service";

const IMPORT_LIMIT = new InMemoryRateLimiter(60, 60_000);

/**
 * Employee-session API for the CRM UI. Reads are RBAC-scoped inside the
 * query service (employee: own calls, manager: team, admin: all); device
 * management, deletion, import and retention need COMPANY_ADMIN or above.
 */
@UseGuards(AuthGuard, RolesGuard)
@Controller("api/v1/mobile")
export class MobileAdminController {
  constructor(
    private readonly query: MobileCallsQueryService,
    private readonly devices: MobileDevicesService,
    private readonly ingest: MobileCallsService,
    private readonly prisma: PrismaService,
  ) {}

  // ---- calls (declare static paths before :id) ----

  @Get("calls")
  async list(@CurrentEmployee() actor: AuthenticatedEmployee, @Query() q: ListCallsQuery) {
    await this.query.assertAdminForEmployeeFilter(actor, q.employee_id);
    return this.query.list(actor, {
      employeeId: q.employee_id,
      deviceId: q.device_id,
      leadId: q.lead_id,
      phoneNumber: q.phone_number,
      callType: q.call_type,
      from: q.from,
      to: q.to,
      minDuration: q.min_duration,
      maxDuration: q.max_duration,
      source: q.source,
      q: q.q,
      unassigned: q.unassigned,
      page: q.page ?? 1,
      limit: q.limit ?? 25,
    });
  }

  @Get("calls/summary")
  async summary(@CurrentEmployee() actor: AuthenticatedEmployee, @Query() q: SummaryQuery) {
    await this.query.assertAdminForEmployeeFilter(actor, q.employee_id);
    return this.query.summary(actor, { from: q.from, to: q.to, employeeId: q.employee_id });
  }

  @Roles(Role.COMPANY_ADMIN)
  @Delete("calls")
  async removeMany(@CurrentEmployee() actor: AuthenticatedEmployee, @Query() q: DeleteCallsQuery) {
    return this.query.removeMany(actor, {
      employeeId: q.employee_id,
      deviceId: q.device_id,
      from: q.from,
      to: q.to,
    });
  }

  @Get("calls/:id")
  async get(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.query.get(actor, id);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Delete("calls/:id")
  async remove(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.query.remove(actor, id);
  }

  @Post("calls/:id/attach")
  @HttpCode(200)
  async attach(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AttachLeadDto) {
    return this.query.attachToLead(actor, id, dto.leadId);
  }

  @Post("calls/:id/create-lead")
  async createLead(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateLeadFromCallDto) {
    return this.query.createLeadFromCall(actor, id, dto.fullName);
  }

  // ---- retention ----

  @Roles(Role.COMPANY_ADMIN)
  @Get("settings")
  async settings(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.query.getSettings(actor);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Patch("settings")
  async setSettings(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: RetentionDto) {
    return this.query.setRetention(actor, dto.callRetentionDays ?? null);
  }

  // ---- devices ----

  @Roles(Role.COMPANY_ADMIN)
  @Get("devices")
  async listDevices(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.devices.list(actor);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Post("devices")
  async createDevice(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateDeviceDto) {
    return this.devices.create(actor, dto);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Get("devices/:id")
  async getDevice(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.devices.get(actor, id);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Patch("devices/:id")
  async updateDevice(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(actor, id, dto);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Post("devices/:id/regenerate-token")
  @HttpCode(200)
  async regenerate(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.devices.regenerateToken(actor, id);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Post("devices/:id/status")
  @HttpCode(200)
  async setStatus(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetDeviceStatusDto) {
    return this.devices.setStatus(actor, id, dto.status);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Delete("devices/:id/calls")
  async clearDeviceCalls(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.devices.clearCalls(actor, id);
  }

  @Roles(Role.COMPANY_ADMIN)
  @Delete("devices/:id")
  async removeDevice(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) {
    return this.devices.remove(actor, id);
  }

  /**
   * Back-fill a device's history from a file an admin uploaded in the UI
   * (call-log exports such as SMS Backup & Restore's calls XML). Parsed in
   * the browser into the same record shape the phone sends; batches of up
   * to 500 go through the exact same ingest/dedupe path.
   */
  @Roles(Role.COMPANY_ADMIN)
  @Post("devices/:id/import")
  @HttpCode(200)
  async importCalls(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ImportCallsDto) {
    IMPORT_LIMIT.assert(actor.id);
    const device = await this.prisma.mobileDevice.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { id: true, organizationId: true, employeeId: true },
    });
    if (!device) throw new NotFoundException("Device not found");

    const summary = await this.ingest.ingest(device, dto.calls, "import");
    await this.ingest.touchDevice(device.id, { sync: true, lastExternalCallId: summary.lastExternalCallId });
    await this.prisma.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: summary.received >= 200 ? "mobile.import_large" : "mobile.import",
        targetType: "MobileDevice",
        targetId: device.id,
        metadata: { received: summary.received, created: summary.created, duplicates: summary.duplicates, rejected: summary.rejected, failed: summary.failed },
      },
    });
    return {
      success: summary.failed === 0,
      received: summary.received,
      created: summary.created,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      failed: summary.failed,
      errors: summary.results.filter((r) => r.status === "rejected" || r.status === "failed").slice(0, 50),
    };
  }
}
