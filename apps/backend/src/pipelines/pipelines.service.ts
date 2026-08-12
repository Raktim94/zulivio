import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";

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

  /** Every org gets exactly one default pipeline, created lazily on first use. */
  async getOrCreateDefaultPipeline(organizationId: string) {
    const existing = await this.prisma.pipeline.findFirst({
      where: { organizationId, isDefault: true },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
    if (existing) return existing;

    return this.prisma.pipeline.create({
      data: {
        organizationId,
        name: "Sales Pipeline",
        isDefault: true,
        stages: { create: DEFAULT_STAGES },
      },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async list(actor: AuthenticatedEmployee) {
    await this.getOrCreateDefaultPipeline(actor.organizationId);
    return this.prisma.pipeline.findMany({
      where: { organizationId: actor.organizationId },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
  }
}
