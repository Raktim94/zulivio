import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Lead, Prisma } from "@prisma/client";
import {
  CallDisposition,
  CallOutcome,
  FollowUpStatus,
  LeadActivityType,
  LeadLossReason,
  LeadPriority,
  LeadStatus,
  PipelineKind,
  Role,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { AssignmentRulesService } from "../assignment-rules/assignment-rules.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { CALL_PROVIDER, type CallProvider } from "../calling/calling.types";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { ConvertLeadDto } from "./dto/convert-lead.dto";
import { ChangeLeadStageDto } from "./dto/change-lead-stage.dto";
import { UpdateQualificationDto } from "./dto/update-qualification.dto";
import { LogCallDto } from "./dto/log-call.dto";
import { CreateLeadNoteDto } from "./dto/create-lead-note.dto";
import { BulkAssignLeadsDto, BulkStageLeadsDto, BulkTagLeadsDto } from "./dto/bulk-lead-action.dto";
import { LeadAccessService } from "./lead-access.service";
import { LeadActivityService, DISPOSITIONS_BY_OUTCOME } from "./lead-activity.service";
import { LeadScoringService } from "./lead-scoring.service";
import { LeadFollowUpsService } from "./lead-follow-ups.service";
import { deriveLeadStatus, requiredQualificationFor } from "./lead-stages";

// A lead can be contacted, then qualified or disqualified; a qualified
// lead converts into an opportunity via a dedicated endpoint, not a
// plain status update.
// Exported so other services (e.g. Agent Assist) can read "what's the valid
// next step from here" without duplicating this state machine.
export const LEAD_ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: [LeadStatus.CONTACTED, LeadStatus.DISQUALIFIED],
  CONTACTED: [LeadStatus.QUALIFIED, LeadStatus.DISQUALIFIED],
  QUALIFIED: [LeadStatus.DISQUALIFIED],
  DISQUALIFIED: [],
  CONVERTED: [],
};

/** Terminal states: a converted or disqualified lead is not worked further. */
const CLOSED_STATUSES: LeadStatus[] = [LeadStatus.CONVERTED, LeadStatus.DISQUALIFIED];

const OWNER_SELECT = { select: { id: true, fullName: true, employeeNumber: true } } as const;

export interface LeadSearchFilters {
  q?: string;
  status?: LeadStatus;
  stageId?: string;
  ownerId?: string;
  source?: string;
  priority?: LeadPriority;
  tag?: string;
  minScore?: number;
  maxScore?: number;
  followUpFrom?: string;
  followUpTo?: string;
  createdFrom?: string;
  createdTo?: string;
  overdue?: boolean;
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentRules: AssignmentRulesService,
    private readonly pipelines: PipelinesService,
    private readonly access: LeadAccessService,
    private readonly activity: LeadActivityService,
    private readonly scoring: LeadScoringService,
    private readonly followUps: LeadFollowUpsService,
    @Inject(CALL_PROVIDER) private readonly callProvider: CallProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Pre-existing endpoints. Their request/response contracts are unchanged
  // — POST /api/v1/leads in particular is called by a live external
  // integration (Submify), so new fields are only ever *added* to the
  // response, never removed or renamed.
  // ---------------------------------------------------------------------

  async create(actor: AuthenticatedEmployee, dto: CreateLeadDto) {
    if (dto.ownerId) {
      await this.access.assertAssignableOwner(actor, dto.ownerId);
    }

    let ownerId = dto.ownerId;
    let respondBySlaAt: Date | undefined;

    if (!ownerId && dto.autoAssign) {
      const picked = await this.assignmentRules.assignNext(actor.organizationId, {
        territory: dto.territory,
      });
      if (picked) {
        ownerId = picked.employeeId;
        respondBySlaAt = new Date(Date.now() + picked.slaMinutes * 60_000);
      }
    }

    // Place every new lead on the first stage of the telecalling board so
    // it shows up on the board immediately instead of in a null-stage
    // limbo. Best-effort: if stage seeding ever failed, the lead is still
    // created — losing an inbound lead over a board detail would be far
    // worse than a lead with no stage.
    const leadPipeline = await this.pipelines.getOrCreateLeadPipeline(actor.organizationId);
    const firstStage = leadPipeline.stages[0];

    const lead = await this.prisma.lead.create({
      data: {
        organizationId: actor.organizationId,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        source: dto.source,
        notes: dto.notes,
        territory: dto.territory,
        ownerId,
        createdById: actor.id,
        respondBySlaAt,
        jobTitle: dto.jobTitle,
        website: dto.website,
        campaign: dto.campaign,
        tags: dto.tags ?? [],
        priority: dto.priority ?? LeadPriority.NORMAL,
        pipelineId: leadPipeline.id,
        stageId: firstStage?.id,
        stageChangedAt: firstStage ? new Date() : undefined,
      },
    });

    return lead;
  }

  async list(actor: AuthenticatedEmployee, filters: { status?: LeadStatus; overdue?: boolean }) {
    const scopeWhere = await this.access.leadScopeWhere(actor);

    return this.prisma.lead.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.overdue
          ? {
              respondBySlaAt: { lt: new Date() },
              firstRespondedAt: null,
              status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
            }
          : {}),
        ...scopeWhere,
      },
      include: { owner: OWNER_SELECT },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Most recent scoped lead matching a phone number, or null — used by Agent Assist. Never throws on no match. */
  async findByPhone(actor: AuthenticatedEmployee, phone: string) {
    const scopeWhere = await this.access.leadScopeWhere(actor);
    return this.prisma.lead.findFirst({
      where: { organizationId: actor.organizationId, phone, ...scopeWhere },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(actor: AuthenticatedEmployee, id: string) {
    return this.access.findScopedLead(actor, id);
  }

  async update(actor: AuthenticatedEmployee, id: string, dto: UpdateLeadDto) {
    const lead = await this.access.findScopedLead(actor, id);

    if (dto.ownerId) {
      await this.access.assertAssignableOwner(actor, dto.ownerId);
    }

    if (dto.status && dto.status !== lead.status) {
      const allowed = LEAD_ALLOWED_TRANSITIONS[lead.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot transition lead from ${lead.status} to ${dto.status}`);
      }
    }

    const firstRespondedAt =
      dto.status && dto.status !== LeadStatus.NEW && !lead.firstRespondedAt ? new Date() : undefined;

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        notes: dto.notes,
        territory: dto.territory,
        status: dto.status,
        ownerId: dto.ownerId,
        firstRespondedAt,
        jobTitle: dto.jobTitle,
        website: dto.website,
        campaign: dto.campaign,
        tags: dto.tags,
        priority: dto.priority,
      },
    });

    if (dto.ownerId && dto.ownerId !== lead.ownerId) {
      await this.recordReassignment(actor, lead, dto.ownerId);
    }
    if (dto.status && dto.status !== lead.status) {
      await this.activity.record({
        organizationId: actor.organizationId,
        leadId: id,
        actorId: actor.id,
        type: LeadActivityType.STATUS_CHANGE,
        metadata: { from: lead.status, to: dto.status },
      });
    }

    return updated;
  }

  /** Transactionally converts a qualified lead into an opportunity, without losing lead history. */
  async convert(actor: AuthenticatedEmployee, id: string, dto: ConvertLeadDto) {
    const lead = await this.access.findScopedLead(actor, id);

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException("Lead has already been converted");
    }
    if (lead.status === LeadStatus.DISQUALIFIED) {
      throw new BadRequestException("Cannot convert a disqualified lead");
    }

    const pipeline = dto.pipelineId
      ? await this.prisma.pipeline.findFirst({
          where: {
            id: dto.pipelineId,
            organizationId: actor.organizationId,
            // Guard added with the telecalling board: the lead pipeline is
            // a Pipeline row too, and putting an Opportunity on a lead
            // stage would corrupt every forecast figure.
            kind: PipelineKind.OPPORTUNITY,
          },
          include: { stages: { orderBy: { sortOrder: "asc" } } },
        })
      : await this.pipelines.getOrCreateDefaultPipeline(actor.organizationId);

    if (!pipeline || pipeline.stages.length === 0) {
      throw new BadRequestException("Target pipeline has no stages configured");
    }
    const firstStage = pipeline.stages[0];

    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.create({
        data: {
          organizationId: actor.organizationId,
          pipelineId: pipeline.id,
          stageId: firstStage.id,
          title: dto.title,
          company: lead.company,
          // Carry the qualified budget across when the caller didn't name
          // an amount — it is the number the telecaller already captured.
          amountMinor: dto.amountMinor ?? lead.budgetMinor ?? 0,
          leadId: lead.id,
          ownerId: lead.ownerId ?? actor.id,
          createdById: actor.id,
        },
      });

      await tx.opportunityEvent.create({
        data: {
          opportunityId: opportunity.id,
          toStageId: firstStage.id,
          actorId: actor.id,
          reason: `Converted from lead #${lead.id.slice(0, 8)}`,
        },
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: { status: LeadStatus.CONVERTED, convertedOpportunityId: opportunity.id },
      });

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: lead.id,
          actorId: actor.id,
          type: LeadActivityType.STATUS_CHANGE,
          body: `Converted to opportunity "${dto.title}"`,
          metadata: { opportunityId: opportunity.id, from: lead.status, to: LeadStatus.CONVERTED },
        },
        tx,
      );

      return opportunity;
    });
  }

  // ---------------------------------------------------------------------
  // Telecalling CRM additions
  // ---------------------------------------------------------------------

  /**
   * Server-side search, filtering and pagination.
   *
   * Deliberately a *new* endpoint rather than a change to GET
   * /api/v1/leads: that one returns a bare array today and existing
   * clients index into it, so wrapping it in `{ items, total }` would be a
   * breaking change for no benefit.
   */
  async search(actor: AuthenticatedEmployee, filters: LeadSearchFilters) {
    const scopeWhere = await this.access.leadScopeWhere(actor);
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(Math.max(1, filters.pageSize ?? 25), MAX_PAGE_SIZE);

    const where: Prisma.LeadWhereInput = {
      organizationId: actor.organizationId,
      ...scopeWhere,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.stageId ? { stageId: filters.stageId } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(filters.unassigned ? { ownerId: null } : {}),
      ...(filters.source ? { source: { equals: filters.source, mode: "insensitive" } } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
      ...(filters.minScore !== undefined || filters.maxScore !== undefined
        ? { score: { gte: filters.minScore, lte: filters.maxScore } }
        : {}),
      ...(filters.followUpFrom || filters.followUpTo
        ? {
            nextFollowUpAt: {
              gte: parseDate(filters.followUpFrom),
              lte: parseDate(filters.followUpTo),
            },
          }
        : {}),
      ...(filters.createdFrom || filters.createdTo
        ? { createdAt: { gte: parseDate(filters.createdFrom), lte: parseDate(filters.createdTo) } }
        : {}),
      ...(filters.overdue
        ? {
            respondBySlaAt: { lt: new Date() },
            firstRespondedAt: null,
            status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
          }
        : {}),
      ...(filters.q ? buildSearchWhere(filters.q) : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: { owner: OWNER_SELECT, stage: true },
        orderBy: resolveSort(filters.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** Everything the lead detail workspace renders, in one round trip. */
  async detail(actor: AuthenticatedEmployee, id: string) {
    const lead = await this.access.findScopedLead(actor, id);

    const [full, activities, followUps, leadPipeline, config] = await Promise.all([
      this.prisma.lead.findUniqueOrThrow({
        where: { id },
        include: { owner: OWNER_SELECT, stage: true, createdBy: OWNER_SELECT },
      }),
      this.activity.listForLead(id),
      this.followUps.listForLead(actor, id),
      this.pipelines.getOrCreateLeadPipeline(actor.organizationId),
      this.scoring.getConfig(actor.organizationId),
    ]);

    return {
      lead: full,
      scoreBand: this.scoring.band(full.score, config),
      scoreBreakdown: this.scoring.breakdown(full, config),
      stages: leadPipeline.stages,
      activities,
      followUps,
      nextAllowedStatuses: LEAD_ALLOWED_TRANSITIONS[lead.status] ?? [],
      dialUri: this.callProvider.name === "manual" && full.phone ? `tel:${full.phone}` : null,
    };
  }

  /**
   * Moves a lead across the telecalling board.
   *
   * The coarse LeadStatus is derived from the target stage rather than
   * running through LEAD_ALLOWED_TRANSITIONS — a board is meant to allow
   * a card to go backwards (Interested → Contacted after a bad second
   * call), which that forward-only state machine forbids by design. The
   * state machine still governs PATCH /api/v1/leads/:id, so no existing
   * caller sees different behavior.
   */
  async changeStage(actor: AuthenticatedEmployee, id: string, dto: ChangeLeadStageDto) {
    const lead = await this.access.findScopedLead(actor, id);

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException("A converted lead is managed on the deal pipeline, not the lead board");
    }

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: dto.stageId, pipeline: { organizationId: actor.organizationId, kind: PipelineKind.LEAD } },
    });
    if (!stage) throw new NotFoundException("Lead stage not found");

    if (stage.isLost && !dto.lossReason) {
      throw new BadRequestException("lossReason is required when moving a lead to a loss stage");
    }

    // Qualification gate: a stage that claims the lead is qualified must
    // actually have the answers behind it, so "Qualified" means the same
    // thing for every rep. The board sends them with the drop.
    const qualification = omitUndefined(dto.qualification);
    const merged = { ...lead, ...qualification };
    const required = requiredQualificationFor(stage);
    const missing = required.filter((field) => {
      if (field === "budget") return (merged.budgetMinor ?? 0) <= 0;
      if (field === "timeline") return merged.timelineDays === null || merged.timelineDays === undefined;
      return (merged.requirement ?? "").trim().length === 0;
    });
    if (missing.length > 0) {
      throw new BadRequestException(
        `Stage "${stage.name}" needs these qualification fields first: ${missing.join(", ")}`,
      );
    }

    const config = await this.scoring.getConfig(actor.organizationId);
    const score = this.scoring.score(merged, config);
    const derivedStatus = deriveLeadStatus(stage);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.lead.update({
        where: { id },
        data: {
          stageId: stage.id,
          pipelineId: stage.pipelineId,
          stageChangedAt: now,
          status: derivedStatus,
          score,
          ...qualification,
          ...(stage.isLost ? { lossReason: dto.lossReason, lossNotes: dto.lossNotes } : {}),
          // Clear a stale loss reason when a lead is revived off a loss stage.
          ...(!stage.isLost && lead.lossReason ? { lossReason: null, lossNotes: null } : {}),
          ...(derivedStatus === LeadStatus.QUALIFIED && !lead.qualifiedAt ? { qualifiedAt: now } : {}),
          ...(derivedStatus !== LeadStatus.NEW && !lead.firstRespondedAt ? { firstRespondedAt: now } : {}),
        },
        include: { owner: OWNER_SELECT, stage: true },
      });

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: id,
          actorId: actor.id,
          type: LeadActivityType.STAGE_CHANGE,
          body: stage.name,
          metadata: {
            fromStageId: lead.stageId,
            toStageId: stage.id,
            toStageName: stage.name,
            status: derivedStatus,
            ...(dto.lossReason ? { lossReason: dto.lossReason } : {}),
          },
        },
        tx,
      );

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "lead.stage_changed",
          targetType: "lead",
          targetId: id,
          metadata: { fromStageId: lead.stageId, toStageId: stage.id, status: derivedStatus },
        },
      });

      return result;
    });

    return updated;
  }

  async updateQualification(actor: AuthenticatedEmployee, id: string, dto: UpdateQualificationDto) {
    const lead = await this.access.findScopedLead(actor, id);
    const config = await this.scoring.getConfig(actor.organizationId);

    const changes = omitUndefined(dto);
    const merged = { ...lead, ...changes };
    const score = this.scoring.score(merged, config);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.lead.update({
        where: { id },
        data: { ...changes, score },
        include: { owner: OWNER_SELECT, stage: true },
      });

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: id,
          actorId: actor.id,
          type: LeadActivityType.QUALIFICATION_UPDATED,
          metadata: {
            scoreBefore: lead.score,
            scoreAfter: score,
            changed: Object.keys(changes),
          },
        },
        tx,
      );

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "lead.qualification_changed",
          targetType: "lead",
          targetId: id,
          metadata: { scoreBefore: lead.score, scoreAfter: score, fields: Object.keys(changes) },
        },
      });

      return result;
    });

    return { lead: updated, score, band: this.scoring.band(score, config) };
  }

  /**
   * Hands the client whatever it needs to place the call. With the manual
   * provider that is a tel: URI; with a future bridged provider it would be
   * an external call id the client polls. Either way the *caller* is this
   * one method, so swapping providers changes nothing here.
   */
  async startCall(actor: AuthenticatedEmployee, id: string) {
    const lead = await this.access.findScopedLead(actor, id);
    if (!lead.phone) throw new BadRequestException("Lead has no phone number");

    return this.callProvider.placeCall({ leadId: lead.id, phone: lead.phone, agentId: actor.id });
  }

  /**
   * Records the outcome of a call: the timeline entry, the lead's contact
   * counters, an optional follow-up, and any stage movement the
   * disposition implies — one round trip, so the telecaller taps once and
   * moves to the next lead.
   */
  async logCall(actor: AuthenticatedEmployee, id: string, dto: LogCallDto) {
    const lead = await this.access.findScopedLead(actor, id);

    const valid = DISPOSITIONS_BY_OUTCOME[dto.outcome];
    if (!valid.includes(dto.disposition)) {
      throw new BadRequestException(
        `Disposition ${dto.disposition} is not valid for a ${dto.outcome} call`,
      );
    }

    const now = new Date();
    const targetStage = await this.stageForDisposition(actor.organizationId, dto.disposition);

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          lastContactedAt: now,
          callCount: { increment: 1 },
          ...(dto.outcome === CallOutcome.CONNECTED && !lead.firstRespondedAt
            ? { firstRespondedAt: now }
            : {}),
        },
      });

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: id,
          actorId: actor.id,
          type: LeadActivityType.CALL,
          body: dto.notes ?? null,
          callOutcome: dto.outcome,
          callDisposition: dto.disposition,
          callDurationSeconds: dto.durationSeconds ?? null,
          metadata: { provider: this.callProvider.name },
        },
        tx,
      );
    });

    // Stage movement runs outside the transaction above because it is its
    // own audited operation with its own qualification gate — and a stage
    // it can't satisfy must not roll back the call record, which is the
    // thing that actually happened.
    if (targetStage && targetStage.id !== lead.stageId) {
      try {
        await this.changeStage(actor, id, {
          stageId: targetStage.id,
          lossReason: LOSS_REASON_BY_DISPOSITION[dto.disposition],
        });
      } catch {
        // Missing qualification for the implied stage: the call is still
        // logged, the rep just moves the card themselves.
      }
    }

    if (dto.followUpAt) {
      await this.followUps.create(actor, id, { dueAt: dto.followUpAt, note: dto.followUpNote });
    }

    return this.detail(actor, id);
  }

  /** Maps a disposition onto the board stage it implies, when there is an unambiguous one. */
  private async stageForDisposition(organizationId: string, disposition: CallDisposition) {
    const stageName = STAGE_NAME_BY_DISPOSITION[disposition];
    if (!stageName) return null;

    const pipeline = await this.pipelines.getOrCreateLeadPipeline(organizationId);
    // Name match against the seeded stages; an org that renamed a stage
    // simply gets no automatic movement, which is the safe failure.
    return pipeline.stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase()) ?? null;
  }

  async addNote(actor: AuthenticatedEmployee, id: string, dto: CreateLeadNoteDto) {
    await this.access.findScopedLead(actor, id);
    return this.activity.record({
      organizationId: actor.organizationId,
      leadId: id,
      actorId: actor.id,
      type: dto.type ?? LeadActivityType.NOTE,
      body: dto.body,
    });
  }

  async listActivities(actor: AuthenticatedEmployee, id: string, limit?: number) {
    await this.access.findScopedLead(actor, id);
    return this.activity.listForLead(id, limit ?? 100);
  }

  /**
   * "Call Next Lead": the single most important lead for this telecaller to
   * pick up right now, by the priority order in the brief —
   *   overdue follow-up > follow-up due soon > hot lead > new lead >
   *   oldest untouched lead.
   * Each tier is a separate narrow query rather than one clever ORDER BY,
   * because the tiers have genuinely different filters and a reviewer can
   * read this and check the order is right.
   */
  async nextLead(actor: AuthenticatedEmployee) {
    const now = new Date();
    const config = await this.scoring.getConfig(actor.organizationId);
    const base: Prisma.LeadWhereInput = {
      organizationId: actor.organizationId,
      ownerId: actor.id,
      status: { notIn: CLOSED_STATUSES },
    };
    const include = { owner: OWNER_SELECT, stage: true };

    const overdueFollowUp = await this.prisma.lead.findFirst({
      where: { ...base, followUps: { some: { status: FollowUpStatus.PENDING, dueAt: { lt: now } } } },
      orderBy: { nextFollowUpAt: "asc" },
      include,
    });
    if (overdueFollowUp) return { reason: "overdue_follow_up" as const, lead: overdueFollowUp };

    const soon = new Date(now.getTime() + 2 * 60 * 60_000);
    const scheduledCallback = await this.prisma.lead.findFirst({
      where: {
        ...base,
        followUps: { some: { status: FollowUpStatus.PENDING, dueAt: { gte: now, lte: soon } } },
      },
      orderBy: { nextFollowUpAt: "asc" },
      include,
    });
    if (scheduledCallback) return { reason: "scheduled_callback" as const, lead: scheduledCallback };

    const hot = await this.prisma.lead.findFirst({
      where: { ...base, score: { gte: config.hotThreshold } },
      orderBy: [{ score: "desc" }, { lastContactedAt: { sort: "asc", nulls: "first" } }],
      include,
    });
    if (hot) return { reason: "hot_lead" as const, lead: hot };

    const fresh = await this.prisma.lead.findFirst({
      where: { ...base, status: LeadStatus.NEW, lastContactedAt: null },
      orderBy: { createdAt: "asc" },
      include,
    });
    if (fresh) return { reason: "new_lead" as const, lead: fresh };

    const stale = await this.prisma.lead.findFirst({
      where: base,
      orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      include,
    });
    if (stale) return { reason: "oldest_untouched" as const, lead: stale };

    return { reason: "queue_empty" as const, lead: null };
  }

  /** The telecaller's own day: what to call, what's due, what's hot. */
  async myDay(actor: AuthenticatedEmployee) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const config = await this.scoring.getConfig(actor.organizationId);
    const mine: Prisma.LeadWhereInput = {
      organizationId: actor.organizationId,
      ownerId: actor.id,
      status: { notIn: CLOSED_STATUSES },
    };
    const include = { owner: OWNER_SELECT, stage: true };

    const [toContact, hotLeads, recentlyAssigned, followUpDashboard, callsToday, meetingsToday] =
      await Promise.all([
        this.prisma.lead.findMany({
          where: { ...mine, OR: [{ lastContactedAt: null }, { nextFollowUpAt: { lte: endOfToday } }] },
          orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: 25,
          include,
        }),
        this.prisma.lead.findMany({
          where: { ...mine, score: { gte: config.hotThreshold } },
          orderBy: { score: "desc" },
          take: 10,
          include,
        }),
        this.prisma.lead.findMany({
          where: { ...mine, createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60_000) } },
          orderBy: { createdAt: "desc" },
          take: 10,
          include,
        }),
        this.followUps.dashboard(actor),
        this.prisma.leadActivity.count({
          where: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            type: LeadActivityType.CALL,
            createdAt: { gte: startOfToday },
          },
        }),
        this.prisma.leadActivity.count({
          where: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            type: LeadActivityType.MEETING,
            createdAt: { gte: startOfToday, lte: endOfToday },
          },
        }),
      ]);

    const connectedToday = await this.prisma.leadActivity.count({
      where: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        type: LeadActivityType.CALL,
        callOutcome: CallOutcome.CONNECTED,
        createdAt: { gte: startOfToday },
      },
    });

    return {
      generatedAt: now.toISOString(),
      toContact,
      hotLeads,
      recentlyAssigned,
      followUps: followUpDashboard,
      stats: {
        callsToday,
        connectedToday,
        meetingsToday,
        openLeads: await this.prisma.lead.count({ where: mine }),
      },
    };
  }

  // --- Assignment (built on the existing assignment-rules engine) ---

  async assign(actor: AuthenticatedEmployee, id: string, ownerId: string | null) {
    const lead = await this.access.findScopedLead(actor, id);
    if (actor.role === Role.EMPLOYEE) {
      throw new ForbiddenException("Only managers and above can reassign leads");
    }
    if (ownerId) await this.access.assertAssignableOwner(actor, ownerId);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { ownerId },
      include: { owner: OWNER_SELECT, stage: true },
    });
    await this.recordReassignment(actor, lead, ownerId);
    return updated;
  }

  private async recordReassignment(actor: AuthenticatedEmployee, lead: Lead, toOwnerId: string | null) {
    await this.prisma.$transaction([
      this.prisma.leadActivity.create({
        data: {
          organizationId: actor.organizationId,
          leadId: lead.id,
          actorId: actor.id,
          type: LeadActivityType.ASSIGNMENT_CHANGED,
          metadata: { fromOwnerId: lead.ownerId, toOwnerId },
        },
      }),
      this.prisma.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "lead.reassigned",
          targetType: "lead",
          targetId: lead.id,
          metadata: { fromOwnerId: lead.ownerId, toOwnerId },
        },
      }),
    ]);
  }

  /**
   * Bulk assign/reassign. With no ownerId it runs the org's *existing*
   * active assignment rule once per lead, so round-robin/territory/capacity
   * behavior is identical to single-lead auto-assignment — this is a new
   * entry point onto that engine, not a second engine.
   */
  async bulkAssign(actor: AuthenticatedEmployee, dto: BulkAssignLeadsDto) {
    const leads = await this.loadBulkTargets(actor, dto.leadIds);
    if (dto.ownerId) await this.access.assertAssignableOwner(actor, dto.ownerId);

    let assigned = 0;
    for (const lead of leads) {
      let ownerId = dto.ownerId ?? null;
      if (!ownerId) {
        const picked = await this.assignmentRules.assignNext(actor.organizationId, {
          territory: lead.territory ?? undefined,
        });
        if (!picked) continue; // no active rule, or everyone at capacity
        ownerId = picked.employeeId;
      }
      if (ownerId === lead.ownerId) continue;

      await this.prisma.lead.update({ where: { id: lead.id }, data: { ownerId } });
      await this.recordReassignment(actor, lead, ownerId);
      assigned += 1;
    }

    return { requested: dto.leadIds.length, matched: leads.length, assigned };
  }

  async bulkChangeStage(actor: AuthenticatedEmployee, dto: BulkStageLeadsDto) {
    const leads = await this.loadBulkTargets(actor, dto.leadIds);
    let moved = 0;
    const skipped: { leadId: string; reason: string }[] = [];

    for (const lead of leads) {
      try {
        await this.changeStage(actor, lead.id, { stageId: dto.stageId });
        moved += 1;
      } catch (error) {
        skipped.push({ leadId: lead.id, reason: (error as Error).message });
      }
    }
    return { requested: dto.leadIds.length, matched: leads.length, moved, skipped };
  }

  /** Adds tags without dropping existing ones — bulk tagging is additive by design. */
  async bulkTag(actor: AuthenticatedEmployee, dto: BulkTagLeadsDto) {
    const leads = await this.loadBulkTargets(actor, dto.leadIds);
    const clean = [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];

    let tagged = 0;
    for (const lead of leads) {
      const merged = [...new Set([...lead.tags, ...clean])];
      if (merged.length === lead.tags.length) continue;
      await this.prisma.lead.update({ where: { id: lead.id }, data: { tags: merged } });
      tagged += 1;
    }
    return { requested: dto.leadIds.length, matched: leads.length, tagged };
  }

  /**
   * Loads exactly the requested leads the actor is authorized for. Ids
   * outside their scope are silently dropped rather than failing the whole
   * batch — and, importantly, are never acted on.
   */
  private async loadBulkTargets(actor: AuthenticatedEmployee, leadIds: string[]) {
    if (actor.role === Role.EMPLOYEE) {
      throw new ForbiddenException("Only managers and above can run bulk lead actions");
    }
    const scopeWhere = await this.access.leadScopeWhere(actor);
    return this.prisma.lead.findMany({
      where: { id: { in: leadIds }, organizationId: actor.organizationId, ...scopeWhere },
    });
  }
}

/**
 * Dispositions that unambiguously imply a board stage. Deliberately
 * partial: "callback" or "no answer" say nothing about where the lead
 * belongs, so those never move the card.
 */
const STAGE_NAME_BY_DISPOSITION: Partial<Record<CallDisposition, string>> = {
  [CallDisposition.INTERESTED]: "Interested",
  [CallDisposition.QUALIFIED]: "Qualified",
  [CallDisposition.MEETING_BOOKED]: "Meeting Booked",
  [CallDisposition.PROPOSAL_REQUESTED]: "Proposal Sent",
  [CallDisposition.NOT_INTERESTED]: "Lost",
  [CallDisposition.NO_BUDGET]: "Lost",
  [CallDisposition.COMPETITOR]: "Lost",
  [CallDisposition.INVALID_NUMBER]: "Lost",
};

const LOSS_REASON_BY_DISPOSITION: Partial<Record<CallDisposition, LeadLossReason>> = {
  [CallDisposition.NOT_INTERESTED]: LeadLossReason.NOT_INTERESTED,
  [CallDisposition.NO_BUDGET]: LeadLossReason.NO_BUDGET,
  [CallDisposition.COMPETITOR]: LeadLossReason.COMPETITOR,
  [CallDisposition.INVALID_NUMBER]: LeadLossReason.WRONG_NUMBER,
};

/**
 * class-transformer materializes absent optional DTO properties as
 * `undefined` keys. Spreading those over a loaded record would blank out
 * fields the caller never mentioned — harmless for a Prisma `data` object
 * (Prisma ignores undefined) but wrong for the in-memory record we score
 * against, so strip them first.
 */
function omitUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Free-text search across the fields a telecaller actually has in hand
 * mid-call: a name, a number someone read out, a company, or the short id
 * prefix shown on the card.
 */
function buildSearchWhere(q: string): Prisma.LeadWhereInput {
  const term = q.trim();
  if (!term) return {};
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { fullName: contains },
      { email: contains },
      { phone: contains },
      { company: contains },
      { id: { startsWith: term.toLowerCase() } },
    ],
  };
}

function resolveSort(sort?: string): Prisma.LeadOrderByWithRelationInput {
  switch (sort) {
    case "score":
      return { score: "desc" };
    case "followUp":
      return { nextFollowUpAt: { sort: "asc", nulls: "last" } };
    case "lastContacted":
      return { lastContactedAt: { sort: "desc", nulls: "last" } };
    case "oldest":
      return { createdAt: "asc" };
    default:
      return { createdAt: "desc" };
  }
}
