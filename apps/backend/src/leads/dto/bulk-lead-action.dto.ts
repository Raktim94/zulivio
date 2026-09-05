import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { LeadLossReason } from "@prisma/client";

/**
 * The 500-id cap keeps one request from turning into an unbounded
 * transaction; the UI pages well below it.
 */
class BulkLeadIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  leadIds!: string[];
}

export class BulkAssignLeadsDto extends BulkLeadIdsDto {
  /** Omit to run the org's active assignment rule for each lead instead of naming an owner. */
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class BulkStageLeadsDto extends BulkLeadIdsDto {
  @IsString()
  stageId!: string;

  /** Required by the server when `stageId` names a loss stage — see ChangeLeadStageDto. */
  @IsOptional()
  @IsEnum(LeadLossReason)
  lossReason?: LeadLossReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  lossNotes?: string;
}

/**
 * Permanently removes the selected leads (same effect as `DELETE
 * /leads/:id`, run per lead). This is the destructive counterpart to
 * `BulkStageLeadsDto` moving leads to a loss stage: prefer disqualifying a
 * bad batch over deleting it, and reach for this only when the data itself
 * needs to go — e.g. a bad test import.
 */
export class BulkDeleteLeadsDto extends BulkLeadIdsDto {}

export class BulkTagLeadsDto extends BulkLeadIdsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];
}
