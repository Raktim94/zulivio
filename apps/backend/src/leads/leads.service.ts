import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { AssignmentRulesService } from "../assignment-rules/assignment-rules.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { ConvertLeadDto } from "./dto/convert-lead.dto";


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

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentRules: AssignmentRulesService,
    private readonly pipelines: PipelinesService,
  ) {}


  async create(actor: AuthenticatedEmployee, dto: CreateLeadDto) {
    if (dto.ownerId) {
      const owner = await this.prisma.employee.findFirst({
        where: { id: dto.ownerId, organizationId: actor.organizationId },
      });
      if (!owner) throw new BadRequestException("ownerId does not belong to this organization");
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

    return this.prisma.lead.create({
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
      },
    });
  }

  async list(actor: AuthenticatedEmployee, filters: { status?: LeadStatus; overdue?: boolean }) {
    const scoped = !isManagerOrAbove(actor.role);

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
        ...(scoped ? { OR: [{ ownerId: actor.id }, { createdById: actor.id }] } : {}),
      },
      include: {
        owner: { select: { id: true, fullName: true, employeeNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Most recent scoped lead matching a phone number, or null — used by Agent Assist. Never throws on no match. */
  async findByPhone(actor: AuthenticatedEmployee, phone: string) {
    const scoped = !isManagerOrAbove(actor.role);
    return this.prisma.lead.findFirst({
      where: {
        organizationId: actor.organizationId,
        phone,
        ...(scoped ? { OR: [{ ownerId: actor.id }, { createdById: actor.id }] } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async findScoped(actor: AuthenticatedEmployee, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!lead) throw new NotFoundException("Lead not found");

    const scoped = !isManagerOrAbove(actor.role);
    if (scoped && lead.ownerId !== actor.id && lead.createdById !== actor.id) {
      throw new ForbiddenException("Not authorized to view this lead");
    }
    return lead;
  }

  async get(actor: AuthenticatedEmployee, id: string) {
    return this.findScoped(actor, id);
  }

  async update(actor: AuthenticatedEmployee, id: string, dto: UpdateLeadDto) {
    const lead = await this.findScoped(actor, id);

    if (dto.ownerId) {
      const owner = await this.prisma.employee.findFirst({
        where: { id: dto.ownerId, organizationId: actor.organizationId },
      });
      if (!owner) throw new BadRequestException("ownerId does not belong to this organization");
    }

    if (dto.status && dto.status !== lead.status) {
      const allowed = LEAD_ALLOWED_TRANSITIONS[lead.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot transition lead from ${lead.status} to ${dto.status}`);
      }
    }

    const firstRespondedAt =
      dto.status && dto.status !== LeadStatus.NEW && !lead.firstRespondedAt ? new Date() : undefined;

    return this.prisma.lead.update({
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
      },
    });
  }

  /** Transactionally converts a qualified lead into an opportunity, without losing lead history. */
  async convert(actor: AuthenticatedEmployee, id: string, dto: ConvertLeadDto) {
    const lead = await this.findScoped(actor, id);

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException("Lead has already been converted");
    }
    if (lead.status === LeadStatus.DISQUALIFIED) {
      throw new BadRequestException("Cannot convert a disqualified lead");
    }

    const pipeline = dto.pipelineId
      ? await this.prisma.pipeline.findFirst({
          where: { id: dto.pipelineId, organizationId: actor.organizationId },
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
          amountMinor: dto.amountMinor ?? 0,
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

      return opportunity;
    });
  }
}
