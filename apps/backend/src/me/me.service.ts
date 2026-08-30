import { Injectable } from "@nestjs/common";
import { AssignmentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { AssignmentsService } from "../assignments/assignments.service";
import { AttendanceService } from "../attendance/attendance.service";
import { ReportsService } from "../reports/reports.service";
import { QualityAuditsService } from "../quality-audits/quality-audits.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { LeadsService, LEAD_ALLOWED_TRANSITIONS } from "../leads/leads.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { TipsService } from "../tips/tips.service";

const PENDING_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.IN_PROGRESS,
  AssignmentStatus.FOLLOW_UP,
  AssignmentStatus.BLOCKED,
];
const DONE_STATUSES: AssignmentStatus[] = [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELED];

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
    private readonly attendance: AttendanceService,
    private readonly reports: ReportsService,
    private readonly qualityAudits: QualityAuditsService,
    private readonly workflows: WorkflowsService,
    private readonly leads: LeadsService,
    private readonly knowledge: KnowledgeService,
    private readonly tips: TipsService,
  ) {}

  /** Today's work summary: assignment counts, attendance state, activity today. */
  async home(actor: AuthenticatedEmployee) {
    const [myAssignments, attendanceState, openLeads] = await Promise.all([
      this.assignments.list(actor, {}),
      this.attendance.currentStatus(actor),
      this.leads.myOpenLeadsSummary(actor),
    ]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const pending = myAssignments.filter((a) => PENDING_STATUSES.includes(a.status));
    const completedToday = myAssignments.filter(
      (a) => a.status === AssignmentStatus.COMPLETED && a.completedAt && a.completedAt >= startOfToday,
    );
    const followUp = myAssignments.filter((a) => a.status === AssignmentStatus.FOLLOW_UP);
    const inProgress = myAssignments.filter((a) => a.status === AssignmentStatus.IN_PROGRESS);

    return {
      attendance: attendanceState,
      summary: {
        assigned: pending.length,
        inProgress: inProgress.length,
        followUp: followUp.length,
        completedToday: completedToday.length,
        openLeads: openLeads.count,
      },
      activeWork: pending
        .slice()
        .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))
        .slice(0, 10),
      assignedLeads: openLeads.leads,
    };
  }

  /** Pending/Completed/My Tasks tabs — own assignments plus in-progress workflow runs. */
  async tasks(actor: AuthenticatedEmployee) {
    const [myAssignments, myRuns] = await Promise.all([this.assignments.list(actor, {}), this.workflows.myRuns(actor)]);

    return {
      pending: myAssignments.filter((a) => PENDING_STATUSES.includes(a.status)),
      completed: myAssignments.filter((a) => DONE_STATUSES.includes(a.status)),
      all: myAssignments,
      workflowRuns: myRuns,
    };
  }

  async qualityAuditResults(actor: AuthenticatedEmployee) {
    return this.qualityAudits.myResults(actor);
  }

  async myReport(actor: AuthenticatedEmployee, from?: Date, to?: Date) {
    return this.reports.employeeTotalReport(actor, actor.id, from, to);
  }

  /**
   * Non-AI "Agent Assist": looks up the CRM record (by leadId, or the most
   * recent lead matching a phone number) and returns real, sourced data —
   * the record's current stage and valid next transitions (from the same
   * state machine leads.service.ts enforces), plus a handful of relevant
   * published Knowledge documents/Tips. No generated guidance, ever.
   */
  async agentAssist(actor: AuthenticatedEmployee, params: { phone?: string; leadId?: string; campaign?: string }) {
    const lead = params.leadId
      ? await this.leads.get(actor, params.leadId)
      : params.phone
        ? await this.leads.findByPhone(actor, params.phone)
        : null;

    const [documents, tipsFeed] = await Promise.all([this.knowledge.list(actor), this.tips.feed(actor)]);

    const query = (params.campaign ?? lead?.source ?? lead?.territory ?? "").toLowerCase();
    const relevantDocuments = (
      query ? documents.filter((d) => matchesQuery(query, d.title, d.category)) : documents
    ).slice(0, 5);
    const relevantTips = (query ? tipsFeed.filter((t) => matchesQuery(query, t.title, t.body)) : tipsFeed).slice(
      0,
      5,
    );

    await this.prisma.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "agent_assist.lookup",
        targetType: "lead",
        targetId: lead?.id ?? null,
        metadata: { campaign: params.campaign ?? null, hasMatch: Boolean(lead) },
      },
    });

    return {
      lead: lead
        ? {
            id: lead.id,
            fullName: lead.fullName,
            status: lead.status,
            ownerId: lead.ownerId,
            territory: lead.territory,
            source: lead.source,
            nextAllowedStatuses: LEAD_ALLOWED_TRANSITIONS[lead.status] ?? [],
          }
        : null,
      knowledgeDocuments: relevantDocuments,
      tips: relevantTips,
    };
  }
}

function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((field) => field?.toLowerCase().includes(query));
}
