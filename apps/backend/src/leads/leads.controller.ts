import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadPriority, LeadStatus } from "@prisma/client";
import { LeadsService } from "./leads.service";
import { LeadScoringService } from "./lead-scoring.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { ConvertLeadDto } from "./dto/convert-lead.dto";
import { ChangeLeadStageDto } from "./dto/change-lead-stage.dto";
import { UpdateQualificationDto } from "./dto/update-qualification.dto";
import { LogCallDto } from "./dto/log-call.dto";
import { CreateLeadNoteDto } from "./dto/create-lead-note.dto";
import { CreateFollowUpDto } from "./dto/follow-up.dto";
import { UpdateLeadScoreConfigDto } from "./dto/update-lead-score-config.dto";
import { BulkAssignLeadsDto, BulkStageLeadsDto, BulkTagLeadsDto } from "./dto/bulk-lead-action.dto";
import { LeadFollowUpsService } from "./lead-follow-ups.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

/**
 * Route order matters: every literal path below is declared *before*
 * `@Get(":id")`, or Nest would match "next"/"search"/"my-day" as a lead id.
 */
@UseGuards(AuthGuard)
@Controller("api/v1/leads")
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly scoring: LeadScoringService,
    private readonly followUps: LeadFollowUpsService,
  ) {}

  /**
   * Unchanged contract: a bare array, same fields plus the additive
   * telecalling ones. Existing clients (including the live Submify
   * integration's downstream reads) keep working untouched — use
   * GET /api/v1/leads/search for filtering and pagination.
   */
  @Get()
  async list(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("status") status?: LeadStatus,
    @Query("overdue") overdue?: string,
  ) {
    return this.leadsService.list(actor, { status, overdue: overdue === "true" });
  }

  @Get("search")
  async search(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("q") q?: string,
    @Query("status") status?: LeadStatus,
    @Query("stageId") stageId?: string,
    @Query("ownerId") ownerId?: string,
    @Query("source") source?: string,
    @Query("priority") priority?: LeadPriority,
    @Query("tag") tag?: string,
    @Query("minScore") minScore?: string,
    @Query("maxScore") maxScore?: string,
    @Query("followUpFrom") followUpFrom?: string,
    @Query("followUpTo") followUpTo?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("overdue") overdue?: string,
    @Query("unassigned") unassigned?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("sort") sort?: string,
  ) {
    return this.leadsService.search(actor, {
      q,
      status,
      stageId,
      ownerId,
      source,
      priority,
      tag,
      minScore: toInt(minScore),
      maxScore: toInt(maxScore),
      followUpFrom,
      followUpTo,
      createdFrom,
      createdTo,
      overdue: overdue === "true",
      unassigned: unassigned === "true",
      page: toInt(page),
      pageSize: toInt(pageSize),
      sort,
    });
  }

  /** The single highest-priority lead for this telecaller to call right now. */
  @Get("next")
  async next(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.leadsService.nextLead(actor);
  }

  /** Telecaller dashboard payload. */
  @Get("my-day")
  async myDay(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.leadsService.myDay(actor);
  }

  @Get("score-config")
  async getScoreConfig(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.scoring.getConfig(actor.organizationId);
  }

  @Patch("score-config")
  async updateScoreConfig(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: UpdateLeadScoreConfigDto,
  ) {
    return this.scoring.updateConfig(actor, dto);
  }

  @Post("bulk/assign")
  async bulkAssign(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: BulkAssignLeadsDto) {
    return this.leadsService.bulkAssign(actor, dto);
  }

  @Post("bulk/stage")
  async bulkStage(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: BulkStageLeadsDto) {
    return this.leadsService.bulkChangeStage(actor, dto);
  }

  @Post("bulk/tag")
  async bulkTag(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: BulkTagLeadsDto) {
    return this.leadsService.bulkTag(actor, dto);
  }

  @Get(":id")
  async get(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.leadsService.get(actor, id);
  }

  /** Everything the lead detail workspace renders, in one round trip. */
  @Get(":id/detail")
  async detail(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.leadsService.detail(actor, id);
  }

  @Get(":id/activities")
  async activities(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Query("limit") limit?: string,
  ) {
    return this.leadsService.listActivities(actor, id, toInt(limit));
  }

  @Get(":id/follow-ups")
  async leadFollowUps(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.followUps.listForLead(actor, id);
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(actor, dto);
  }

  @Patch(":id")
  async update(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(actor, id, dto);
  }

  @Patch(":id/stage")
  async changeStage(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: ChangeLeadStageDto,
  ) {
    return this.leadsService.changeStage(actor, id, dto);
  }

  @Patch(":id/qualification")
  async updateQualification(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: UpdateQualificationDto,
  ) {
    return this.leadsService.updateQualification(actor, id, dto);
  }

  @Patch(":id/assign")
  async assign(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() body: { ownerId?: string | null },
  ) {
    return this.leadsService.assign(actor, id, body.ownerId ?? null);
  }

  /** Asks the configured calling provider for whatever the client needs to dial. */
  @Post(":id/calls")
  async startCall(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.leadsService.startCall(actor, id);
  }

  /** Records the call's outcome + disposition, and anything it implies. */
  @Post(":id/calls/disposition")
  async logCall(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: LogCallDto,
  ) {
    return this.leadsService.logCall(actor, id, dto);
  }

  @Post(":id/notes")
  async addNote(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: CreateLeadNoteDto,
  ) {
    return this.leadsService.addNote(actor, id, dto);
  }

  @Post(":id/follow-ups")
  async createFollowUp(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.followUps.create(actor, id, dto);
  }

  @Post(":id/convert")
  async convert(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leadsService.convert(actor, id, dto);
  }
}

/** Query strings are always strings; returns undefined for absent/garbage input rather than NaN. */
function toInt(value?: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
