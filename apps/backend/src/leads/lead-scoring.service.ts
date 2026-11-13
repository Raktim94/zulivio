import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Lead, LeadScoreConfig } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { UpdateLeadScoreConfigDto } from "./dto/update-lead-score-config.dto";

export type LeadScoreBand = "HOT" | "WARM" | "COLD";

/** The qualification fields the score is computed from. */
type ScorableLead = Pick<
  Lead,
  | "budgetMinor"
  | "isDecisionMaker"
  | "requirement"
  | "requirementUrgent"
  | "timelineDays"
  | "goodBusinessFit"
>;

export interface ScoreBreakdownEntry {
  key: string;
  label: string;
  weight: number;
  earned: boolean;
}

/**
 * Computes a lead's 0-100 score from its qualification answers, using
 * weights stored per organization in LeadScoreConfig rather than constants
 * in this file — tuning "budget is worth 25 points" must not need a
 * redeploy. The defaults match the brief (budget 25, decision maker 20,
 * urgent requirement 20, clear requirement 15, short timeline 10, business
 * fit 10) and live on the Prisma model, so a fresh org gets them without
 * any seeding step.
 */
@Injectable()
export class LeadScoringService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lazily creates the org's config row on first read, like PipelinesService does for the default pipeline. */
  async getConfig(organizationId: string): Promise<LeadScoreConfig> {
    const existing = await this.prisma.leadScoreConfig.findUnique({ where: { organizationId } });
    if (existing) return existing;

    // Prisma's upsert is not atomic: two concurrent first-time reads (a page
    // firing several requests at once) both miss the find, both insert, and
    // one hits the @unique(organizationId) constraint -> a 500 on the first
    // load of /my-day. Treat that unique violation as "someone else just
    // created it" and read their row.
    try {
      return await this.prisma.leadScoreConfig.create({ data: { organizationId } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return this.prisma.leadScoreConfig.findUniqueOrThrow({ where: { organizationId } });
      }
      throw err;
    }
  }

  async updateConfig(actor: AuthenticatedEmployee, dto: UpdateLeadScoreConfigDto) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can change lead scoring weights");
    }
    await this.getConfig(actor.organizationId);

    return this.prisma.leadScoreConfig.update({
      where: { organizationId: actor.organizationId },
      data: {
        budgetAvailableWeight: dto.budgetAvailableWeight,
        decisionMakerWeight: dto.decisionMakerWeight,
        urgentRequirementWeight: dto.urgentRequirementWeight,
        clearRequirementWeight: dto.clearRequirementWeight,
        shortTimelineWeight: dto.shortTimelineWeight,
        goodBusinessFitWeight: dto.goodBusinessFitWeight,
        shortTimelineDays: dto.shortTimelineDays,
        hotThreshold: dto.hotThreshold,
        warmThreshold: dto.warmThreshold,
        updatedById: actor.id,
      },
    });
  }

  breakdown(lead: ScorableLead, config: LeadScoreConfig): ScoreBreakdownEntry[] {
    return [
      {
        key: "budgetAvailable",
        label: "Budget available",
        weight: config.budgetAvailableWeight,
        earned: (lead.budgetMinor ?? 0) > 0,
      },
      {
        key: "decisionMaker",
        label: "Speaking to the decision maker",
        weight: config.decisionMakerWeight,
        earned: lead.isDecisionMaker === true,
      },
      {
        key: "urgentRequirement",
        label: "Urgent requirement",
        weight: config.urgentRequirementWeight,
        earned: lead.requirementUrgent === true,
      },
      {
        key: "clearRequirement",
        label: "Clear requirement captured",
        weight: config.clearRequirementWeight,
        earned: (lead.requirement ?? "").trim().length > 0,
      },
      {
        key: "shortTimeline",
        label: `Timeline under ${config.shortTimelineDays} days`,
        weight: config.shortTimelineWeight,
        earned: lead.timelineDays !== null && lead.timelineDays < config.shortTimelineDays,
      },
      {
        key: "goodBusinessFit",
        label: "Good business fit",
        weight: config.goodBusinessFitWeight,
        earned: lead.goodBusinessFit === true,
      },
    ];
  }

  /**
   * Clamped to 0-100 so a mis-configured set of weights summing above 100
   * can't produce an out-of-band score that breaks the HOT/WARM/COLD
   * reading or the dashboard gauges.
   */
  score(lead: ScorableLead, config: LeadScoreConfig): number {
    const total = this.breakdown(lead, config)
      .filter((entry) => entry.earned)
      .reduce((sum, entry) => sum + entry.weight, 0);
    return Math.max(0, Math.min(100, total));
  }

  band(score: number, config: LeadScoreConfig): LeadScoreBand {
    if (score >= config.hotThreshold) return "HOT";
    if (score >= config.warmThreshold) return "WARM";
    return "COLD";
  }

  async scoreFor(organizationId: string, lead: ScorableLead) {
    const config = await this.getConfig(organizationId);
    const score = this.score(lead, config);
    return { score, band: this.band(score, config), config };
  }
}
