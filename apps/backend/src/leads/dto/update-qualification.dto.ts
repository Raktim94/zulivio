import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { PurchaseIntent } from "@prisma/client";

/**
 * The qualification answers a telecaller captures on the call. Saving any
 * of these re-runs lead scoring against the org's configured weights — the
 * score is never set directly by a client.
 */
export class UpdateQualificationDto {
  /** Minor units (paise), matching Opportunity.amountMinor across the CRM. */
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  timelineDays?: number;

  @IsOptional()
  @IsBoolean()
  isDecisionMaker?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requirement?: string;

  @IsOptional()
  @IsBoolean()
  requirementUrgent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  existingSolution?: string;

  @IsOptional()
  @IsEnum(PurchaseIntent)
  purchaseIntent?: PurchaseIntent;

  @IsOptional()
  @IsBoolean()
  goodBusinessFit?: boolean;
}
