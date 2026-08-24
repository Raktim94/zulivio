import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { FollowUpStatus, LeadActivityType, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { EmployeeScopeService } from "../common/scope.service";
import { LeadAccessService } from "./lead-access.service";
import { LeadActivityService } from "./lead-activity.service";
import { CompleteFollowUpDto, CreateFollowUpDto, RescheduleFollowUpDto } from "./dto/follow-up.dto";

const FOLLOW_UP_INCLUDE = {
  lead: {
    select: {
      id: true,
      fullName: true,
      company: true,
      phone: true,
      email: true,
      status: true,
      score: true,
      priority: true,
      stageId: true,
    },
  },
  assignee: { select: { id: true, fullName: true, employeeNumber: true } },
} satisfies Prisma.LeadFollowUpInclude;

/** The dashboard buckets, in the order a telecaller works them. */
export type FollowUpBucket = "overdue" | "dueNow" | "dueToday" | "tomorrow" | "upcoming";

/**
 * Real, due-dated follow-ups.
 *
 * Before this, "follow-up" existed only as `AssignmentStatus.FOLLOW_UP` on
 * the unrelated Assignment model — a flag with no due date, no per-lead
 * link and no completion record, so nothing could answer "what is overdue
 * right now". That value is left exactly as it is; this is a separate
 * entity for a separate concern.
 */
@Injectable()
export class LeadFollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LeadAccessService,
    private readonly activity: LeadActivityService,
    private readonly scope: EmployeeScopeService,
  ) {}

  private parseDueAt(value: string): Date {
    const dueAt = new Date(value);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("dueAt is not a valid date");
    return dueAt;
  }

  /**
   * An employee may only ever schedule work for themselves. Manager+ may
   * schedule for anyone inside their scope — checked here rather than
   * trusted from the client, since hiding the assignee picker in the UI
   * stops nothing.
   */
  private async resolveAssignee(
    actor: AuthenticatedEmployee,
    requested: string | undefined,
    fallback: string | null,
  ): Promise<string> {
    if (!requested) return fallback ?? actor.id;
    if (requested === actor.id) return actor.id;

    if (actor.role === Role.EMPLOYEE) {
      throw new ForbiddenException("Employees can only schedule follow-ups for themselves");
    }

    const authorized = await this.scope.authorizedEmployeeIds(actor);
    if (!authorized.includes(requested)) {
      throw new ForbiddenException("Not authorized to schedule follow-ups for that employee");
    }
    return requested;
  }

  async create(actor: AuthenticatedEmployee, leadId: string, dto: CreateFollowUpDto) {
    const lead = await this.access.findScopedLead(actor, leadId);
    const dueAt = this.parseDueAt(dto.dueAt);
    const assigneeId = await this.resolveAssignee(actor, dto.assigneeId, lead.ownerId);

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.leadFollowUp.create({
        data: {
          organizationId: actor.organizationId,
          leadId: lead.id,
          assigneeId,
          createdById: actor.id,
          dueAt,
          note: dto.note,
        },
        include: FOLLOW_UP_INCLUDE,
      });

      await this.syncNextFollowUp(tx, lead.id);

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: lead.id,
          actorId: actor.id,
          type: LeadActivityType.FOLLOW_UP_SCHEDULED,
          body: dto.note ?? null,
          metadata: { followUpId: followUp.id, dueAt: dueAt.toISOString(), assigneeId },
        },
        tx,
      );

      return followUp;
    });
  }

  /**
   * Recomputes Lead.nextFollowUpAt from the pending follow-ups that
   * actually exist, rather than assuming the one just written is the
   * earliest — completing or rescheduling has to be able to move it
   * backwards as well as forwards.
   */
  private async syncNextFollowUp(tx: Prisma.TransactionClient, leadId: string) {
    const next = await tx.leadFollowUp.findFirst({
      where: { leadId, status: FollowUpStatus.PENDING },
      orderBy: { dueAt: "asc" },
      select: { dueAt: true },
    });
    await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
  }

  private async findScopedFollowUp(actor: AuthenticatedEmployee, id: string) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!followUp) throw new NotFoundException("Follow-up not found");
    // Authorization rides on the lead, so there is one rule, not two.
    await this.access.findScopedLead(actor, followUp.leadId);
    return followUp;
  }

  async complete(actor: AuthenticatedEmployee, id: string, dto: CompleteFollowUpDto) {
    const followUp = await this.findScopedFollowUp(actor, id);
    if (followUp.status !== FollowUpStatus.PENDING) {
      throw new BadRequestException("Only a pending follow-up can be completed");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadFollowUp.update({
        where: { id },
        data: { status: FollowUpStatus.COMPLETED, completedAt: new Date(), outcome: dto.outcome },
        include: FOLLOW_UP_INCLUDE,
      });

      await this.syncNextFollowUp(tx, followUp.leadId);

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: followUp.leadId,
          actorId: actor.id,
          type: LeadActivityType.FOLLOW_UP_COMPLETED,
          body: dto.outcome ?? null,
          metadata: { followUpId: id },
        },
        tx,
      );

      return updated;
    });
  }

  async reschedule(actor: AuthenticatedEmployee, id: string, dto: RescheduleFollowUpDto) {
    const followUp = await this.findScopedFollowUp(actor, id);
    if (followUp.status !== FollowUpStatus.PENDING) {
      throw new BadRequestException("Only a pending follow-up can be rescheduled");
    }
    const dueAt = this.parseDueAt(dto.dueAt);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadFollowUp.update({
        where: { id },
        data: { dueAt, note: dto.note ?? followUp.note },
        include: FOLLOW_UP_INCLUDE,
      });

      await this.syncNextFollowUp(tx, followUp.leadId);

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: followUp.leadId,
          actorId: actor.id,
          type: LeadActivityType.FOLLOW_UP_RESCHEDULED,
          body: dto.note ?? null,
          metadata: {
            followUpId: id,
            fromDueAt: followUp.dueAt.toISOString(),
            toDueAt: dueAt.toISOString(),
          },
        },
        tx,
      );

      return updated;
    });
  }

  async cancel(actor: AuthenticatedEmployee, id: string) {
    const followUp = await this.findScopedFollowUp(actor, id);
    if (followUp.status !== FollowUpStatus.PENDING) {
      throw new BadRequestException("Only a pending follow-up can be canceled");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadFollowUp.update({
        where: { id },
        data: { status: FollowUpStatus.CANCELED },
        include: FOLLOW_UP_INCLUDE,
      });
      await this.syncNextFollowUp(tx, followUp.leadId);
      return updated;
    });
  }

  async listForLead(actor: AuthenticatedEmployee, leadId: string) {
    await this.access.findScopedLead(actor, leadId);
    return this.prisma.leadFollowUp.findMany({
      where: { leadId },
      orderBy: { dueAt: "asc" },
      include: FOLLOW_UP_INCLUDE,
    });
  }

  /**
   * The follow-up dashboard: every pending follow-up the actor is
   * responsible for, split into the buckets they work in order. Scoped by
   * assignee (whose queue it is), not by lead ownership — a manager sees
   * their team's queues, an employee sees only their own.
   */
  async dashboard(actor: AuthenticatedEmployee, assigneeId?: string) {
    const assigneeFilter = await this.resolveQueueScope(actor, assigneeId);

    const pending = await this.prisma.leadFollowUp.findMany({
      where: {
        organizationId: actor.organizationId,
        status: FollowUpStatus.PENDING,
        ...assigneeFilter,
      },
      orderBy: { dueAt: "asc" },
      include: FOLLOW_UP_INCLUDE,
      take: 500,
    });

    const now = new Date();
    const dueNowCutoff = new Date(now.getTime() + 30 * 60_000);
    const endOfToday = endOfDay(now);
    const endOfTomorrow = endOfDay(new Date(now.getTime() + 24 * 60 * 60_000));

    const buckets: Record<FollowUpBucket, typeof pending> = {
      overdue: [],
      dueNow: [],
      dueToday: [],
      tomorrow: [],
      upcoming: [],
    };

    for (const item of pending) {
      const due = item.dueAt;
      if (due < now) buckets.overdue.push(item);
      else if (due <= dueNowCutoff) buckets.dueNow.push(item);
      else if (due <= endOfToday) buckets.dueToday.push(item);
      else if (due <= endOfTomorrow) buckets.tomorrow.push(item);
      else buckets.upcoming.push(item);
    }

    // Completion rate over the trailing week — the one number that says
    // whether follow-ups are actually being worked, not just created.
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const [completedThisWeek, overdueTotal] = await Promise.all([
      this.prisma.leadFollowUp.count({
        where: {
          organizationId: actor.organizationId,
          status: FollowUpStatus.COMPLETED,
          completedAt: { gte: weekAgo },
          ...assigneeFilter,
        },
      }),
      this.prisma.leadFollowUp.count({
        where: {
          organizationId: actor.organizationId,
          status: FollowUpStatus.PENDING,
          dueAt: { lt: now },
          ...assigneeFilter,
        },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      buckets,
      counts: {
        overdue: buckets.overdue.length,
        dueNow: buckets.dueNow.length,
        dueToday: buckets.dueToday.length,
        tomorrow: buckets.tomorrow.length,
        upcoming: buckets.upcoming.length,
        completedThisWeek,
        overdueTotal,
      },
    };
  }

  /** Employees are pinned to their own queue; Manager+ may narrow to one person inside their scope. */
  private async resolveQueueScope(
    actor: AuthenticatedEmployee,
    assigneeId?: string,
  ): Promise<Prisma.LeadFollowUpWhereInput> {
    if (actor.role === Role.EMPLOYEE) return { assigneeId: actor.id };

    const authorized = await this.scope.authorizedEmployeeIds(actor);

    if (assigneeId) {
      if (!this.access.isOrgWide(actor) && !authorized.includes(assigneeId)) {
        throw new ForbiddenException("Not authorized to view that employee's follow-ups");
      }
      return { assigneeId };
    }

    if (this.access.isOrgWide(actor)) return {};
    return { assigneeId: { in: authorized } };
  }
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
