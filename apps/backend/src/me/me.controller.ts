import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { MeService } from "./me.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get("home")
  async home(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.me.home(actor);
  }

  @Get("tasks")
  async tasks(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.me.tasks(actor);
  }

  @Get("quality-audits")
  async qualityAudits(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.me.qualityAuditResults(actor);
  }

  @Get("reports")
  async reports(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.me.myReport(actor, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get("agent-assist")
  async agentAssist(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("phone") phone?: string,
    @Query("leadId") leadId?: string,
    @Query("campaign") campaign?: string,
  ) {
    return this.me.agentAssist(actor, { phone, leadId, campaign });
  }
}
