import { Body, Controller, Get, Param, Post, Patch, UseGuards } from "@nestjs/common";
import { WorkflowsService } from "./workflows.service";
import { CreateWorkflowDefinitionDto } from "./dto/create-workflow-definition.dto";
import { UpdateWorkflowRunDto } from "./dto/update-workflow-run.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/workflows")
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post("definitions")
  async createDefinition(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateWorkflowDefinitionDto) {
    return this.workflows.createDefinition(actor, dto);
  }

  @Get("definitions")
  async listDefinitions(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.workflows.listDefinitions(actor);
  }

  @Post("definitions/:id/publish")
  async publish(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.workflows.publish(actor, id);
  }

  @Post("definitions/:id/runs")
  async startRun(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.workflows.startRun(actor, id);
  }

  @Patch("runs/:id")
  async updateRun(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: UpdateWorkflowRunDto,
  ) {
    return this.workflows.updateRun(actor, id, dto);
  }

  @Post("runs/:id/complete")
  async completeRun(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.workflows.completeRun(actor, id);
  }
}
