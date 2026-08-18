import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WorkflowRunStatus, WorkflowStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { CreateWorkflowDefinitionDto } from "./dto/create-workflow-definition.dto";
import { UpdateWorkflowRunDto } from "./dto/update-workflow-run.dto";

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAuthor(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can author workflows");
    }
  }

  async createDefinition(actor: AuthenticatedEmployee, dto: CreateWorkflowDefinitionDto) {
    this.assertAuthor(actor);
    return this.prisma.workflowDefinition.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        description: dto.description,
        tags: dto.tags ?? [],
        steps: dto.steps as unknown as Prisma.InputJsonValue,
        status: WorkflowStatus.DRAFT,
        ownerId: actor.id,
      },
    });
  }

  async publish(actor: AuthenticatedEmployee, id: string) {
    this.assertAuthor(actor);
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!definition) throw new NotFoundException("Workflow not found");

    return this.prisma.workflowDefinition.update({
      where: { id },
      data: { status: WorkflowStatus.PUBLISHED },
    });
  }

  /** Employees only ever see PUBLISHED workflows; Manager+ manage the full set. */
  async listDefinitions(actor: AuthenticatedEmployee) {
    return this.prisma.workflowDefinition.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(isManagerOrAbove(actor.role) ? {} : { status: WorkflowStatus.PUBLISHED }),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async startRun(actor: AuthenticatedEmployee, workflowDefinitionId: string) {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { id: workflowDefinitionId, organizationId: actor.organizationId, status: WorkflowStatus.PUBLISHED },
    });
    if (!definition) throw new NotFoundException("Published workflow not found");

    return this.prisma.workflowRun.create({
      data: {
        organizationId: actor.organizationId,
        workflowDefinitionId,
        employeeId: actor.id,
        status: WorkflowRunStatus.IN_PROGRESS,
      },
    });
  }

  private async findOwnRun(actor: AuthenticatedEmployee, runId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, organizationId: actor.organizationId, employeeId: actor.id },
    });
    if (!run) throw new NotFoundException("Workflow run not found");
    return run;
  }

  async updateRun(actor: AuthenticatedEmployee, runId: string, dto: UpdateWorkflowRunDto) {
    const run = await this.findOwnRun(actor, runId);
    if (run.status === WorkflowRunStatus.COMPLETED) {
      throw new BadRequestException("Cannot update a completed workflow run");
    }

    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        currentStepIndex: dto.currentStepIndex,
        answers: dto.answers
          ? ({ ...(run.answers as object), ...dto.answers } as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async completeRun(actor: AuthenticatedEmployee, runId: string) {
    const run = await this.findOwnRun(actor, runId);
    if (run.status === WorkflowRunStatus.COMPLETED) {
      throw new BadRequestException("Workflow run is already completed");
    }

    return this.prisma.$transaction(async (tx) => {
      const completed = await tx.workflowRun.update({
        where: { id: runId },
        data: { status: WorkflowRunStatus.COMPLETED, completedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "workflow_run.completed",
          targetType: "workflow_run",
          targetId: runId,
          metadata: { workflowDefinitionId: run.workflowDefinitionId },
        },
      });

      return completed;
    });
  }

  /** Self-scoped: every run belonging to the actor, any status. */
  async myRuns(actor: AuthenticatedEmployee) {
    return this.prisma.workflowRun.findMany({
      where: { organizationId: actor.organizationId, employeeId: actor.id },
      include: { workflowDefinition: { select: { id: true, name: true, tags: true } } },
      orderBy: { startedAt: "desc" },
    });
  }
}
