import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { CrmReportsService } from "./crm-reports.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly crmReports: CrmReportsService,
  ) {}

  @Get("dashboard")
  async dashboard(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.reportsService.dashboard(actor);
  }

  @Get("sales-dashboard")
  async salesDashboard(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.reportsService.salesDashboard(actor);
  }

  /** Manager dashboard: team telecalling KPIs + per-employee performance. */
  @Get("team-performance")
  async teamPerformance(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.crmReports.teamPerformance(actor, parseDate(from), parseDate(to));
  }

  /** Admin dashboard: org-wide CRM funnel, sources, revenue, follow-up health. */
  @Get("crm-overview")
  async crmOverview(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.crmReports.crmOverview(actor, parseDate(from), parseDate(to));
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

/** Ignores an unparseable date rather than passing Invalid Date into a query. */
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
