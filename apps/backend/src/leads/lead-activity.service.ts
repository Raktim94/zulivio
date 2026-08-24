import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CallDisposition, CallOutcome, LeadActivityType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordActivityInput {
  organizationId: string;
  leadId: string;
  actorId: string;
  type: LeadActivityType;
  body?: string | null;
  metadata?: Prisma.InputJsonValue;
  callOutcome?: CallOutcome | null;
  callDisposition?: CallDisposition | null;
  callDurationSeconds?: number | null;
}

/**
 * Writes and reads the per-lead activity timeline.
 *
 * Every method takes an optional Prisma transaction client so a timeline
 * entry is written in the *same* transaction as the change it describes —
 * a stage move that commits without its STAGE_CHANGE entry (or the reverse)
 * would leave the timeline lying about what happened.
 */
@Injectable()
export class LeadActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordActivityInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.leadActivity.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        actorId: input.actorId,
        type: input.type,
        body: input.body ?? null,
        metadata: input.metadata,
        callOutcome: input.callOutcome ?? null,
        callDisposition: input.callDisposition ?? null,
        callDurationSeconds: input.callDurationSeconds ?? null,
      },
    });
  }

  /**
   * Newest first, capped — a lead worked for months can accumulate
   * thousands of entries and the workspace only ever renders a window of
   * them.
   */
  async listForLead(leadId: string, limit = 100) {
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
      include: {
        actor: { select: { id: true, fullName: true, employeeNumber: true } },
      },
    });
  }
}

/**
 * Which dispositions belong to which outcome. Used to reject a mismatched
 * pair (e.g. outcome NOT_CONNECTED with disposition MEETING_BOOKED), which
 * would otherwise quietly corrupt every connect-rate figure on the manager
 * dashboard.
 */
export const DISPOSITIONS_BY_OUTCOME: Record<CallOutcome, CallDisposition[]> = {
  [CallOutcome.CONNECTED]: [
    CallDisposition.INTERESTED,
    CallDisposition.QUALIFIED,
    CallDisposition.MEETING_BOOKED,
    CallDisposition.CALLBACK,
    CallDisposition.PROPOSAL_REQUESTED,
    CallDisposition.NOT_INTERESTED,
    CallDisposition.NO_BUDGET,
    CallDisposition.COMPETITOR,
    CallDisposition.WRONG_PERSON,
  ],
  [CallOutcome.NOT_CONNECTED]: [
    CallDisposition.NO_ANSWER,
    CallDisposition.BUSY,
    CallDisposition.SWITCHED_OFF,
    CallDisposition.INVALID_NUMBER,
    CallDisposition.OUT_OF_COVERAGE,
  ],
};
