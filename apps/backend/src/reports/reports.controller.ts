import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("dashboard")
  async dashboard(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.reportsService.dashboard(actor);
  }

  @Get("sales-dashboard")
  async salesDashboard(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.reportsService.salesDashboard(actor);
  }

  @Get("employees/:employeeId")
  async employeeReport(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("employeeId") employeeId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reportsService.employeeTotalReport(
      actor,
      employeeId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}
