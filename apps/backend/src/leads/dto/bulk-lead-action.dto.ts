import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { LeadLossReason, LeadPriority, LeadStatus } from "@prisma/client";

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

/**
 * Deletes every lead matching these filters — or, with every filter
 * omitted, every lead the actor can see — in one request. The uncapped
 * counterpart to `BulkDeleteLeadsDto`'s 500-id list: it's what powers
 * "select all N leads matching this filter" on the Leads list, and Data
 * Hub's "delete all leads" danger zone (called with no filters). Mirrors
 * `GET /leads/search`'s filters exactly so the same filter state a manager
 * is looking at is what gets deleted.
 *
 * `acknowledge` must be `true`: a deliberate tripwire so a client bug that
 * fires this request with an empty body can't silently wipe every lead.
 */
export class DeleteAllLeadsDto {
  @IsIn([true])
  acknowledge!: true;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxScore?: number;

  @IsOptional()
  @IsDateString()
  followUpFrom?: string;

  @IsOptional()
  @IsDateString()
  followUpTo?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsBoolean()
  unassigned?: boolean;
}
