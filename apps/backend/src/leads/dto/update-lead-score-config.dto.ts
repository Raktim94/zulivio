import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Every weight is 0-100 individually. The total is deliberately *not*
 * constrained to 100 — an org may want a strict rubric where only a
 * near-perfect lead reaches HOT — so LeadScoringService clamps the computed
 * score to 0-100 instead of rejecting the configuration.
 */
export class UpdateLeadScoreConfigDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) budgetAvailableWeight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) decisionMakerWeight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) urgentRequirementWeight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) clearRequirementWeight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) shortTimelineWeight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) goodBusinessFitWeight?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3650) shortTimelineDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) hotThreshold?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) warmThreshold?: number;
}
