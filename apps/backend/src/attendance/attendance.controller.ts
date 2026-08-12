import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { StartBreakDto } from "./dto/start-break.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/work-sessions")
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get("me")
  async me(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.attendanceService.currentStatus(actor);
  }

  @Get("report/:employeeId")
  async report(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("employeeId") employeeId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.attendanceService.report(
      actor,
      employeeId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post("start")
  async start(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.attendanceService.start(actor);
  }

  @Post(":id/breaks/start")
  async startBreak(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: StartBreakDto,
  ) {
    return this.attendanceService.startBreak(actor, id, dto.reason);
  }

  @Post(":id/breaks/:breakId/end")
  async endBreak(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Param("breakId") breakId: string,
  ) {
    return this.attendanceService.endBreak(actor, id, breakId);
  }

  @Post(":id/end")
  async end(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.attendanceService.endSession(actor, id);
  }
}
