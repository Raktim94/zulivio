import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { QualityAuditsService } from "./quality-audits.service";
import { CreateQualityAuditDefinitionDto } from "./dto/create-quality-audit-definition.dto";
import { CreateQualityAuditResultDto } from "./dto/create-quality-audit-result.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/quality-audits")
export class QualityAuditsController {
  constructor(private readonly qualityAudits: QualityAuditsService) {}

  @Post("definitions")
  async createDefinition(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: CreateQualityAuditDefinitionDto,
  ) {
    return this.qualityAudits.createDefinition(actor, dto);
  }

  @Get("definitions")
  async listDefinitions(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.qualityAudits.listDefinitions(actor);
  }

  @Post("results")
  async createResult(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateQualityAuditResultDto) {
    return this.qualityAudits.createResult(actor, dto);
  }

  @Get("results")
  async listResults(@CurrentEmployee() actor: AuthenticatedEmployee, @Query("employeeId") employeeId?: string) {
    return this.qualityAudits.listResults(actor, employeeId);
  }

  @Post("results/:id/publish")
  async publish(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.qualityAudits.publish(actor, id);
  }

  @Post("results/:id/acknowledge")
  async acknowledge(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.qualityAudits.acknowledge(actor, id);
  }
}
