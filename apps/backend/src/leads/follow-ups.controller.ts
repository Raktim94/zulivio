import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadFollowUpsService } from "./lead-follow-ups.service";
import { CompleteFollowUpDto, RescheduleFollowUpDto } from "./dto/follow-up.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

/**
 * Cross-lead follow-up queue. Creating a follow-up lives on the lead
 * (POST /api/v1/leads/:id/follow-ups) because it always belongs to one;
 * everything here is about working the queue afterwards.
 */
@UseGuards(AuthGuard)
@Controller("api/v1/follow-ups")
export class FollowUpsController {
  constructor(private readonly followUps: LeadFollowUpsService) {}

  /** Pending follow-ups bucketed into overdue / due now / today / tomorrow / upcoming. */
  @Get()
  async dashboard(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("assigneeId") assigneeId?: string,
  ) {
    return this.followUps.dashboard(actor, assigneeId);
  }

  @Patch(":id/complete")
  async complete(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: CompleteFollowUpDto,
  ) {
    return this.followUps.complete(actor, id, dto);
  }

  @Patch(":id/reschedule")
  async reschedule(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: RescheduleFollowUpDto,
  ) {
    return this.followUps.reschedule(actor, id, dto);
  }

  @Post(":id/cancel")
  async cancel(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.followUps.cancel(actor, id);
  }
}
