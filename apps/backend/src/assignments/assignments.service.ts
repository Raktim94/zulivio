import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AssignmentStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";

const MANAGER_RANK: Role[] = [Role.MANAGER, Role.SALES_HEAD, Role.COMPANY_ADMIN, Role.MASTER_OWNER];

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
  constructor(private readonly prisma: PrismaService) {}

  private isManagerOrAbove(role: Role): boolean {
    return MANAGER_RANK.includes(role);
  }

  async create(actor: AuthenticatedEmployee, dto: CreateAssignmentDto) {
    if (dto.ownerId) {
      const owner = await this.prisma.employee.findFirst({
        where: { id: dto.ownerId, organizationId: actor.organizationId },
      });
      if (!owner) {
        throw new BadRequestException("ownerId does not belong to this organization");
      }
    }

    const existingCount = await this.prisma.assignment.count({
      where: { organizationId: actor.organizationId },
    });

    return this.prisma.$transaction(async (tx) => {
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
  }

  async assign(actor: AuthenticatedEmployee, assignmentId: string, employeeId: string, reason?: string) {
    if (!this.isManagerOrAbove(actor.role)) {
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
    if (!isOwner && !isCreator && !this.isManagerOrAbove(actor.role)) {
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

  async list(actor: AuthenticatedEmployee, filters: { status?: AssignmentStatus; ownerId?: string }) {
    const scoped = !this.isManagerOrAbove(actor.role);

    return this.prisma.assignment.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
        ...(scoped ? { OR: [{ ownerId: actor.id }, { createdById: actor.id }] } : {}),
      },
      include: {
        owner: { select: { id: true, fullName: true, employeeNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
