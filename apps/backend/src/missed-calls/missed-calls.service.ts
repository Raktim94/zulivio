import { BadRequestException, Injectable } from "@nestjs/common";
import { FollowUpStatus, LeadActivityType, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { normalizePhone, phoneLast10 } from "../common/phone.util";
import { PipelinesService } from "../pipelines/pipelines.service";
import { LeadActivityService } from "../leads/lead-activity.service";
import { RecordMissedCallDto } from "./dto/record-missed-call.dto";

/**
 * Ingests a "Call Missed" event from an employee's phone (via MacroDroid's
 * HTTP Request action — see docs/integrations/macrodroid.md) and turns it
 * into CRM work: match it onto an existing lead by phone number, or open a
 * new one, then drop a due-now follow-up so it surfaces in the "call them
 * back" queue instead of sitting silently in the timeline.
 *
 * `actor` here is whichever employee the request's API key resolves to —
 * the same employee whose phone the missed-call trigger fired on (see
 * ApiKeysService.issueFor). There is deliberately no per-lead scope check:
 * a missed call is an event about a phone number, not a request to view
 * someone else's book, and the org-wide phone match below is what stops a
 * duplicate lead being created just because the existing one belongs to a
 * different employee.
 */
@Injectable()
export class MissedCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
    private readonly activity: LeadActivityService,
  ) {}

  async record(actor: AuthenticatedEmployee, dto: RecordMissedCallDto) {
    const phone = normalizePhone(dto.phoneNumber);
    const last10 = phoneLast10(dto.phoneNumber);
    if (!phone || !last10) {
      throw new BadRequestException("phoneNumber must contain at least one digit");
    }

    const existing = await this.prisma.lead.findFirst({
      where: { organizationId: actor.organizationId, phone: { endsWith: last10 } },
      orderBy: { createdAt: "desc" },
    });

    const note = dto.deviceName
      ? `Missed call via MacroDroid (${dto.deviceName})`
      : "Missed call via MacroDroid";

    if (existing) {
      const ownerId = existing.ownerId ?? actor.id;

      await this.prisma.$transaction(async (tx) => {
        if (!existing.ownerId) {
          await tx.lead.update({ where: { id: existing.id }, data: { ownerId } });
        }

        await this.activity.record(
          {
            organizationId: actor.organizationId,
            leadId: existing.id,
            actorId: actor.id,
            type: LeadActivityType.CALL,
            body: note,
            metadata: { source: "MACRODROID", event: "MISSED_CALL", deviceName: dto.deviceName ?? null },
          },
          tx,
        );

        await this.scheduleCallback(tx, actor, existing.id, ownerId, note);
      });

      return { success: true, leadId: existing.id, matched: true, action: "MISSED_CALL_LOGGED" };
    }

    const pipeline = await this.pipelines.getOrCreateLeadPipeline(actor.organizationId);
    const firstStage = pipeline.stages[0];

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          organizationId: actor.organizationId,
          fullName: dto.callerName?.trim() || phone,
          phone,
          source: "MISSED_CALL",
          ownerId: actor.id,
          createdById: actor.id,
          pipelineId: pipeline.id,
          stageId: firstStage?.id,
          stageChangedAt: firstStage ? new Date() : undefined,
        },
      });

      await this.activity.record(
        {
          organizationId: actor.organizationId,
          leadId: created.id,
          actorId: actor.id,
          type: LeadActivityType.CALL,
          body: note,
          metadata: { source: "MACRODROID", event: "MISSED_CALL", deviceName: dto.deviceName ?? null },
        },
        tx,
      );

      await this.scheduleCallback(tx, actor, created.id, actor.id, note);

      return created;
    });

    return { success: true, leadId: lead.id, matched: false, action: "LEAD_CREATED" };
  }

  /**
   * Due-now follow-up so the missed call shows up in the assignee's
   * follow-up queue, not just buried in the lead timeline — and keeps
   * Lead.nextFollowUpAt in sync the same way LeadFollowUpsService does,
   * without pulling in its actor-scoped `findScopedLead` (which would
   * reject this write whenever the matched lead belongs to a different
   * employee than the one whose phone the call landed on).
   */
  private async scheduleCallback(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedEmployee,
    leadId: string,
    assigneeId: string,
    note: string,
  ) {
    const dueAt = new Date();
    await tx.leadFollowUp.create({
      data: {
        organizationId: actor.organizationId,
        leadId,
        assigneeId,
        createdById: actor.id,
        dueAt,
        note,
      },
    });

    const next = await tx.leadFollowUp.findFirst({
      where: { leadId, status: FollowUpStatus.PENDING },
      orderBy: { dueAt: "asc" },
    });
    await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
  }
}
