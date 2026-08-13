import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { AuthGuard, SESSION_COOKIE } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// Independent from NODE_ENV: this app is self-hosted (CasaOS/ZimaOS,
// docker compose on a home LAN) and its x-casaos manifest declares
// scheme: http. NODE_ENV is "production" in every real deployment, but
// most of those are plain HTTP — a cookie with `secure: true` is
// silently dropped by the browser on a non-HTTPS origin, which broke
// login entirely (the POST succeeds and returns 200, but no session
// cookie is ever stored, so every subsequent request looks logged out).
// Opt in explicitly via COOKIE_SECURE=true only when running behind a
// real HTTPS reverse proxy.
const cookieSecure = process.env.COOKIE_SECURE === "true";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sessions")
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });

    res.cookie(SESSION_COOKIE, result.rawToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      maxAge: result.expiresInMs,
      path: "/",
    });

    return { employee: result.employee };
  }

  @UseGuards(AuthGuard)
  @Post("sessions/logout")
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout((req as unknown as { sessionId: string }).sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Post("change-password")
  async changePassword(
    @CurrentEmployee() employee: AuthenticatedEmployee,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      employee.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { ok: true };
  }
}
