import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AssignmentRulesService } from "./assignment-rules.service";
import { CreateAssignmentRuleDto } from "./dto/create-assignment-rule.dto";
import { SetActiveDto } from "./dto/set-active.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/assignment-rules")
export class AssignmentRulesController {
  constructor(private readonly assignmentRulesService: AssignmentRulesService) {}

  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.assignmentRulesService.list(actor);
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateAssignmentRuleDto) {
    return this.assignmentRulesService.create(actor, dto);
  }

  @Patch(":id/active")
  async setActive(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.assignmentRulesService.setActive(actor, id, dto.isActive);
  }
}
