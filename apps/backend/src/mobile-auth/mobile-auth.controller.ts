import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { MobileApiExceptionFilter } from "../mobile-calls/mobile-api-error.filter";
import { MobileDeviceGuard, type AuthenticatedDevice } from "../mobile-calls/mobile-device.guard";
import { MobileLoginDto, MobileLogoutDto, MobileRefreshDto } from "./dto";
import { MobileAuthService } from "./mobile-auth.service";

interface DeviceRequest extends Request {
  mobileDevice: AuthenticatedDevice;
}

/** Contract version the Android app checks; bump only for breaking changes. */
export const MOBILE_API_VERSION = 1;

@Public()
@UseFilters(MobileApiExceptionFilter)
@Controller("api/v1/mobile")
export class MobileAuthController {
  constructor(private readonly service: MobileAuthService) {}

  /** Pre-login reachability + compatibility check. Reveals no organization data. */
  @Get("server-info")
  info() {
    return {
      product: "zulivio",
      apiVersion: MOBILE_API_VERSION,
      serverVersion: process.env.APP_VERSION ?? "dev",
      authentication: "password",
      capabilities: { contacts: true, callLog: true, followUps: true, attendance: true },
      serverTime: new Date().toISOString(),
    };
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: MobileLoginDto, @Req() req: Request) {
    return this.service.login(dto.email, dto.password, dto.device, req.ip ?? "unknown");
  }

  @Post("auth/refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: MobileRefreshDto, @Req() req: Request) {
    return this.service.refresh(dto.refreshToken, req.ip ?? "unknown");
  }

  @UseGuards(MobileDeviceGuard)
  @Get("auth/me")
  me(@Req() req: DeviceRequest) {
    return this.service.me(req.mobileDevice.id);
  }

  @UseGuards(MobileDeviceGuard)
  @Post("auth/logout")
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: DeviceRequest, @Body() dto: MobileLogoutDto) {
    const d = req.mobileDevice;
    return this.service.logout(d.id, d.organizationId, d.employeeId, d.tokenFamilyId, dto.purgeContacts === true);
  }
}
