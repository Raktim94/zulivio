import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OpportunityStatus } from "@prisma/client";
import { OpportunitiesService } from "./opportunities.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { MoveStageDto } from "./dto/move-stage.dto";
import { SetForecastCategoryDto } from "./dto/set-forecast-category.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/opportunities")
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Get()
  async list(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("pipelineId") pipelineId?: string,
    @Query("status") status?: OpportunityStatus,
  ) {
    return this.opportunitiesService.list(actor, { pipelineId, status });
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateOpportunityDto) {
    return this.opportunitiesService.create(actor, dto);
  }

  @Post(":id/stage-transitions")
  async moveStage(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: MoveStageDto,
  ) {
    return this.opportunitiesService.moveStage(actor, id, dto);
  }

  @Post(":id/forecast-category")
  async setForecastCategory(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: SetForecastCategoryDto,
  ) {
    return this.opportunitiesService.setForecastCategory(actor, id, dto);
  }
}
