import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { OpportunityStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { PipelinesService } from "../pipelines/pipelines.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { MoveStageDto } from "./dto/move-stage.dto";
import { SetForecastCategoryDto } from "./dto/set-forecast-category.dto";


@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}


  async create(actor: AuthenticatedEmployee, dto: CreateOpportunityDto) {
    const pipeline = dto.pipelineId
      ? await this.prisma.pipeline.findFirst({
          where: { id: dto.pipelineId, organizationId: actor.organizationId },
          include: { stages: { orderBy: { sortOrder: "asc" } } },
        })
      : await this.pipelines.getOrCreateDefaultPipeline(actor.organizationId);

    if (!pipeline || pipeline.stages.length === 0) {
      throw new BadRequestException("Target pipeline has no stages configured");
    }

    const stage = dto.stageId
      ? pipeline.stages.find((s) => s.id === dto.stageId)
      : pipeline.stages[0];
    if (!stage) throw new BadRequestException("stageId does not belong to the selected pipeline");

    if (dto.ownerId) {
      const owner = await this.prisma.employee.findFirst({
        where: { id: dto.ownerId, organizationId: actor.organizationId },
      });
      if (!owner) throw new BadRequestException("ownerId does not belong to this organization");
    }

    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.create({
        data: {
          organizationId: actor.organizationId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          title: dto.title,
          company: dto.company,
          amountMinor: dto.amountMinor ?? 0,
          ownerId: dto.ownerId ?? actor.id,
          createdById: actor.id,
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
        },
      });

      await tx.opportunityEvent.create({
        data: { opportunityId: opportunity.id, toStageId: stage.id, actorId: actor.id, reason: "Created" },
      });

      return opportunity;
    });
  }

  async list(actor: AuthenticatedEmployee, filters: { pipelineId?: string; status?: OpportunityStatus }) {
    const scoped = !isManagerOrAbove(actor.role);

    return this.prisma.opportunity.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(scoped ? { OR: [{ ownerId: actor.id }, { createdById: actor.id }] } : {}),
      },
      include: {
        owner: { select: { id: true, fullName: true, employeeNumber: true } },
        stage: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async findScoped(actor: AuthenticatedEmployee, id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { stage: true, pipeline: { include: { stages: true } } },
    });
    if (!opportunity) throw new NotFoundException("Opportunity not found");

    const scoped = !isManagerOrAbove(actor.role);
    if (scoped && opportunity.ownerId !== actor.id && opportunity.createdById !== actor.id) {
      throw new ForbiddenException("Not authorized to view this opportunity");
    }
    return opportunity;
  }

  async moveStage(actor: AuthenticatedEmployee, id: string, dto: MoveStageDto) {
    const opportunity = await this.findScoped(actor, id);

    if (opportunity.status !== OpportunityStatus.OPEN) {
      throw new BadRequestException("Cannot move a closed (won/lost) opportunity");
    }

    const targetStage = opportunity.pipeline.stages.find((s) => s.id === dto.stageId);
    if (!targetStage) {
      throw new BadRequestException("stageId does not belong to this opportunity's pipeline");
    }
    if (targetStage.isLost && !dto.lossReason) {
      throw new BadRequestException("lossReason is required when moving to a lost stage");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opportunity.update({
        where: { id },
        data: {
          stageId: targetStage.id,
          stageChangedAt: new Date(),
          status: targetStage.isWon
            ? OpportunityStatus.WON
            : targetStage.isLost
              ? OpportunityStatus.LOST
              : OpportunityStatus.OPEN,
          lossReason: targetStage.isLost ? dto.lossReason : undefined,
        },
      });

      await tx.opportunityEvent.create({
        data: {
          opportunityId: id,
          fromStageId: opportunity.stageId,
          toStageId: targetStage.id,
          actorId: actor.id,
          reason: dto.reason ?? dto.lossReason,
        },
      });

      return updated;
    });
  }

  /** Manager+ override of the automatic forecast rollup, with a full audit trail. */
  async setForecastCategory(actor: AuthenticatedEmployee, id: string, dto: SetForecastCategoryDto) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can adjust the forecast");
    }

    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!opportunity) throw new NotFoundException("Opportunity not found");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opportunity.update({
        where: { id },
        data: { forecastCategory: dto.category },
      });

      await tx.forecastAdjustment.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: id,
          actorId: actor.id,
          previousCategory: opportunity.forecastCategory,
          newCategory: dto.category,
          previousAmountMinor: opportunity.amountMinor,
          newAmountMinor: opportunity.amountMinor,
          reason: dto.reason,
        },
      });

      return updated;
    });
  }
}
