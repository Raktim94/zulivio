import { Body, CanActivate, ExecutionContext, ForbiddenException, Injectable, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { InMemoryRateLimiter } from "../common/rate-limiter";
import { MobileApiExceptionFilter } from "../mobile-calls/mobile-api-error.filter";
import { MobileDeviceGuard, type AuthenticatedDevice } from "../mobile-calls/mobile-device.guard";
import { ContactImportDto, ContactListQuery, ContactPreviewDto } from "./dto";
import { MobileContactsService } from "./mobile-contacts.service";

const IMPORT_LIMIT = new InMemoryRateLimiter(30, 60_000, "Rate limit exceeded. Retry in a minute.");

/** Static admin-issued device tokens (MacroDroid etc.) exist for call ingest only; contacts need a signed-in app session. */
@Injectable()
class AppSessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.mobileDevice?.tokenFamilyId) {
      throw new ForbiddenException({ code: "APP_SESSION_REQUIRED", message: "Contacts require a signed-in app session." });
    }
    return true;
  }
}

interface DeviceRequest extends Request {
  mobileDevice: AuthenticatedDevice;
}

/**
 * Phone contacts the signed-in employee chose to share. @Public() only opts
 * out of the browser-session guard; MobileDeviceGuard is the real gate and
 * binds every call to the device, employee and organization the token
 * resolves to. Nothing in a request body can change those.
 */
@Public()
@UseGuards(MobileDeviceGuard, AppSessionOnlyGuard)
@UseFilters(MobileApiExceptionFilter)
@Controller("api/v1/mobile/contacts")
export class MobileContactsController {
  constructor(private readonly service: MobileContactsService) {}

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(@Req() req: DeviceRequest, @Body() dto: ContactPreviewDto) {
    IMPORT_LIMIT.assert(req.mobileDevice.id);
    return this.service.preview(req.mobileDevice, dto.contacts, dto.fields ?? []);
  }

  @Post("import")
  @HttpCode(HttpStatus.OK)
  import(@Req() req: DeviceRequest, @Body() dto: ContactImportDto) {
    IMPORT_LIMIT.assert(req.mobileDevice.id);
    return this.service.import(req.mobileDevice, dto.contacts, dto.fields);
  }

  @Get()
  list(@Req() req: DeviceRequest, @Query() q: ContactListQuery) {
    return this.service.list(req.mobileDevice, q.q, q.cursor, q.limit);
  }

  @Get("summary")
  summary(@Req() req: DeviceRequest) {
    return this.service.summary(req.mobileDevice);
  }

  /** Remove every contact this device uploaded (or `?scope=employee` for all of this user's devices). */
  @Delete()
  deleteAll(@Req() req: DeviceRequest, @Query("scope") scope?: string) {
    return this.service.deleteAll(req.mobileDevice, scope === "employee" ? "employee" : "device");
  }

  @Delete(":id")
  deleteOne(@Req() req: DeviceRequest, @Param("id") id: string) {
    return this.service.deleteOne(req.mobileDevice, id);
  }
}
