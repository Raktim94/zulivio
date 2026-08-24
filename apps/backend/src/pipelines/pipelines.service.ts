import { Injectable } from "@nestjs/common";
import { PipelineKind } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { DEFAULT_LEAD_STAGES, LEAD_PIPELINE_NAME } from "../leads/lead-stages";

const DEFAULT_STAGES = [
  { name: "New", sortOrder: 0, probability: 10 },
  { name: "Qualified", sortOrder: 1, probability: 25 },
  { name: "Proposal", sortOrder: 2, probability: 50 },
  { name: "Negotiation", sortOrder: 3, probability: 75 },
  { name: "Won", sortOrder: 4, probability: 100, isWon: true },
  { name: "Lost", sortOrder: 5, probability: 0, isLost: true },
];

@Injectable()
export class PipelinesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every org gets exactly one default opportunity pipeline, created lazily on first use. */
  async getOrCreateDefaultPipeline(organizationId: string) {
    const existing = await this.prisma.pipeline.findFirst({
      where: { organizationId, isDefault: true, kind: PipelineKind.OPPORTUNITY },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
    if (existing) return existing;

    return this.prisma.pipeline.create({
      data: {
        organizationId,
        name: "Sales Pipeline",
        isDefault: true,
        kind: PipelineKind.OPPORTUNITY,
        stages: { create: DEFAULT_STAGES },
      },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
  }

  /**
   * The telecalling board's pipeline, seeded once per org with the stages
   * in lead-stages.ts. Separate from the opportunity pipeline above because
   * they answer different questions — how a conversation is progressing vs.
   * how a deal is progressing — but they are the *same* Pipeline/
   * PipelineStage models, so stage configuration, drag-and-drop and stage
   * reporting are one implementation, not two.
   */
  async getOrCreateLeadPipeline(organizationId: string) {
    const existing = await this.prisma.pipeline.findFirst({
      where: { organizationId, kind: PipelineKind.LEAD },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return existing;

    return this.prisma.pipeline.create({
      data: {
        organizationId,
        name: LEAD_PIPELINE_NAME,
        // isDefault stays false: it is scoped to `kind`, and the
        // opportunity pipeline is the one existing callers mean by
        // "default".
        isDefault: false,
        kind: PipelineKind.LEAD,
        stages: { create: DEFAULT_LEAD_STAGES },
      },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
  }

  /**
   * Defaults to OPPORTUNITY pipelines only. This is load-bearing for
   * backward compatibility: the web pipeline page reads `pipelines[0]`, so
   * returning the lead pipeline here would silently swap the deal board's
   * stages. Pass kind=LEAD explicitly to get the telecalling board.
   */
  async list(actor: AuthenticatedEmployee, kind: PipelineKind = PipelineKind.OPPORTUNITY) {
    if (kind === PipelineKind.LEAD) {
      await this.getOrCreateLeadPipeline(actor.organizationId);
    } else {
      await this.getOrCreateDefaultPipeline(actor.organizationId);
    }

    return this.prisma.pipeline.findMany({
      where: { organizationId: actor.organizationId, kind },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
  }
}
