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

const isProd = process.env.NODE_ENV === "production";

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
      secure: isProd,
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
