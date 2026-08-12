import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AssignmentStatus } from "@prisma/client";
import { AssignmentsService } from "./assignments.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { AssignDto } from "./dto/assign.dto";
import { TransitionDto } from "./dto/transition.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard, RolesGuard)
@Controller("api/v1/assignments")
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get()
  async list(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("status") status?: AssignmentStatus,
    @Query("ownerId") ownerId?: string,
  ) {
    return this.assignmentsService.list(actor, { status, ownerId });
  }

  @Post()
  async create(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignmentsService.create(actor, dto);
  }

  @Post(":id/assign")
  async assign(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: AssignDto,
  ) {
    return this.assignmentsService.assign(actor, id, dto.employeeId, dto.reason);
  }

  @Post(":id/transitions")
  async transition(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: TransitionDto,
  ) {
    return this.assignmentsService.transition(
      actor,
      id,
      dto.toStatus,
      dto.reason,
      dto.outcome,
      dto.outcomeNotes,
    );
  }
}
