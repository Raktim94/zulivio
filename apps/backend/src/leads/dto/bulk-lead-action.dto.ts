import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Bulk actions are deliberately limited to assign/reassign, stage change
 * and tagging — there is no bulk delete, matching the deactivate-over-
 * delete posture the rest of the app takes.
 *
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
}

export class BulkTagLeadsDto extends BulkLeadIdsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];
}
