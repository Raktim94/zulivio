import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AssignmentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { isManagerOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const MAX_ASSIGNMENT_NUMBER_RETRIES = 5;

const ALLOWED_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  ASSIGNED: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.CANCELED],
  IN_PROGRESS: [
    AssignmentStatus.FOLLOW_UP,
    AssignmentStatus.BLOCKED,
    AssignmentStatus.COMPLETED,
    AssignmentStatus.CANCELED,
  ],
  FOLLOW_UP: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED, AssignmentStatus.CANCELED],
  BLOCKED: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.CANCELED],
  COMPLETED: [],
  CANCELED: [],
};

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  async create(actor: AuthenticatedEmployee, dto: CreateAssignmentDto) {
    if (dto.ownerId) {
      const owner = await this.prisma.employee.findFirst({
        where: { id: dto.ownerId, organizationId: actor.organizationId },
      });
      if (!owner) {
        throw new BadRequestException("ownerId does not belong to this organization");
      }
    }

    if (dto.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: dto.leadId, organizationId: actor.organizationId },
      });
      if (!lead) throw new BadRequestException("leadId does not belong to this organization");
    }

    if (dto.opportunityId) {
      const opportunity = await this.prisma.opportunity.findFirst({
        where: { id: dto.opportunityId, organizationId: actor.organizationId },
      });
      if (!opportunity) throw new BadRequestException("opportunityId does not belong to this organization");
    }

    // assignmentNumber is a per-organization sequential number with a
    // @@unique([organizationId, assignmentNumber]) constraint, not a DB
    // sequence — under concurrent creates, two requests can both read the
    // same count() and collide on that unique constraint. Retry with a
    // fresh count on conflict rather than surfacing a spurious 500.
    for (let attempt = 0; attempt < MAX_ASSIGNMENT_NUMBER_RETRIES; attempt += 1) {
      const existingCount = await this.prisma.assignment.count({
        where: { organizationId: actor.organizationId },
      });

      try {
        return await this.prisma.$transaction(async (tx) => {
          const assignment = await tx.assignment.create({
            data: {
              organizationId: actor.organizationId,
              assignmentNumber: existingCount + 1,
              title: dto.title,
              description: dto.description,
              ownerId: dto.ownerId,
              priority: dto.priority ?? "normal",
              dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
              createdById: actor.id,
              leadId: dto.leadId,
              opportunityId: dto.opportunityId,
            },
          });

          await tx.assignmentEvent.create({
            data: {
              assignmentId: assignment.id,
              toStatus: AssignmentStatus.ASSIGNED,
              actorId: actor.id,
              reason: dto.ownerId ? "Created and assigned" : "Created unassigned",
            },
          });

          return assignment;
        });
      } catch (error) {
        const isAssignmentNumberConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION &&
          (error.meta?.target as string[] | undefined)?.includes("assignmentNumber");

        if (!isAssignmentNumberConflict || attempt === MAX_ASSIGNMENT_NUMBER_RETRIES - 1) {
          throw error;
        }
      }
    }
    // Unreachable: the loop above always returns or throws.
    throw new Error("Failed to allocate an assignment number");
  }

  async assign(actor: AuthenticatedEmployee, assignmentId: string, employeeId: string, reason?: string) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can assign work");
    }

    const [assignment, employee] = await Promise.all([
      this.prisma.assignment.findFirst({
        where: { id: assignmentId, organizationId: actor.organizationId },
      }),
      this.prisma.employee.findFirst({
        where: { id: employeeId, organizationId: actor.organizationId },
      }),
    ]);

    if (!assignment) throw new NotFoundException("Assignment not found");
    if (!employee) throw new BadRequestException("Target employee not in this organization");
    // A Manager may only assign work to their own direct reports; a Sales
    // Head may assign anywhere in their reporting subtree. Being in the
    // same org isn't enough — that's the org-membership check above.
    if (!(await this.employeeScope.isInScope(actor, employeeId))) {
      throw new ForbiddenException("Target employee is outside your authorized scope");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data: { ownerId: employeeId },
      });

      await tx.assignmentEvent.create({
        data: {
          assignmentId,
          fromStatus: assignment.status,
          toStatus: assignment.status,
          actorId: actor.id,
          reason: reason ?? `Reassigned to ${employee.fullName}`,
        },
      });

      return updated;
    });
  }

  async transition(
    actor: AuthenticatedEmployee,
    assignmentId: string,
    toStatus: AssignmentStatus,
    reason?: string,
    outcome?: string,
    outcomeNotes?: string,
  ) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, organizationId: actor.organizationId },
    });

    if (!assignment) throw new NotFoundException("Assignment not found");

    const isOwner = assignment.ownerId === actor.id;
    const isCreator = assignment.createdById === actor.id;
    if (!isOwner && !isCreator && !isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Not authorized to update this assignment");
    }

    const allowed = ALLOWED_TRANSITIONS[assignment.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Cannot transition assignment from ${assignment.status} to ${toStatus}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: toStatus,
          outcome: outcome ?? assignment.outcome,
          outcomeNotes: outcomeNotes ?? assignment.outcomeNotes,
          completedAt: toStatus === AssignmentStatus.COMPLETED ? new Date() : assignment.completedAt,
        },
      });

      await tx.assignmentEvent.create({
        data: {
          assignmentId,
          fromStatus: assignment.status,
          toStatus,
          actorId: actor.id,
          reason,
        },
      });

      return updated;
    });
  }

  async list(actor: AuthenticatedEmployee, filters: { status?: AssignmentStatus; ownerId?: string; leadId?: string }) {
    const scoped = !isManagerOrAbove(actor.role);

    return this.prisma.assignment.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
        ...(filters.leadId ? { leadId: filters.leadId } : {}),
        ...(scoped ? { OR: [{ ownerId: actor.id }, { createdById: actor.id }] } : {}),
      },
      include: {
        owner: { select: { id: true, fullName: true, employeeNumber: true } },
        lead: { select: { id: true, fullName: true, company: true } },
        opportunity: { select: { id: true, title: true, company: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
