import { LeadStatus, PipelineKind } from "@prisma/client";

/**
 * The telecalling board's stages, seeded once per organization as a
 * PipelineKind.LEAD pipeline. These are *seed data*, not a hardcoded
 * enum — an admin can rename, reorder, add or remove stages afterwards
 * and every consumer (board, filters, reports) follows the rows in the
 * database, not this list.
 *
 * `probability` doubles as the qualification threshold: see
 * `deriveLeadStatus` below.
 */
export const LEAD_PIPELINE_NAME = "Telecalling Pipeline";

export const DEFAULT_LEAD_STAGES = [
  { name: "New", sortOrder: 0, probability: 5 },
  { name: "Contacted", sortOrder: 1, probability: 10 },
  { name: "Connected", sortOrder: 2, probability: 20 },
  { name: "Interested", sortOrder: 3, probability: 35 },
  { name: "Qualified", sortOrder: 4, probability: 50 },
  { name: "Meeting Booked", sortOrder: 5, probability: 60 },
  { name: "Proposal Sent", sortOrder: 6, probability: 70 },
  { name: "Negotiation", sortOrder: 7, probability: 85 },
  { name: "Won", sortOrder: 8, probability: 100, isWon: true },
  { name: "Lost", sortOrder: 9, probability: 0, isLost: true },
];

export const LEAD_PIPELINE_KIND = PipelineKind.LEAD;

/** The probability at or above which a stage counts as "qualified". */
export const QUALIFIED_PROBABILITY_THRESHOLD = 50;

/**
 * Maps a configurable board stage onto the coarse `LeadStatus` enum that
 * predates this feature (and that the live Submify integration reads back
 * from POST /api/v1/leads).
 *
 * Derived from the stage's own configurable fields rather than its name, so
 * a renamed or newly added stage still lands on a sensible status:
 *   isLost            → DISQUALIFIED
 *   first stage       → NEW
 *   probability >= 50 → QUALIFIED   (includes isWon, at 100)
 *   otherwise         → CONTACTED
 *
 * CONVERTED is never derived here — it is set only by the existing
 * lead→opportunity conversion endpoint, which stays the single way a lead
 * becomes a deal.
 */
export function deriveLeadStatus(stage: {
  sortOrder: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}): LeadStatus {
  if (stage.isLost) return LeadStatus.DISQUALIFIED;
  if (stage.sortOrder === 0) return LeadStatus.NEW;
  if (stage.probability >= QUALIFIED_PROBABILITY_THRESHOLD) return LeadStatus.QUALIFIED;
  return LeadStatus.CONTACTED;
}

/**
 * Stages that need more information before a lead may land on them, so the
 * board can prompt for exactly those fields in a small contextual modal
 * instead of pushing the telecaller into a full edit form. Keyed by the
 * derived status rather than the stage name so renames don't break it.
 */
export function requiredQualificationFor(stage: {
  sortOrder: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}): ("budget" | "timeline" | "requirement")[] {
  if (stage.isLost) return [];
  if (stage.probability >= QUALIFIED_PROBABILITY_THRESHOLD) {
    return ["budget", "timeline", "requirement"];
  }
  return [];
}
