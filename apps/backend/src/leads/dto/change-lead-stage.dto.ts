import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { LeadLossReason } from "@prisma/client";
import { UpdateQualificationDto } from "./update-qualification.dto";

export class ChangeLeadStageDto {
  @IsString()
  stageId!: string;

  /** Required by the server when the target stage is a loss stage. */
  @IsOptional()
  @IsEnum(LeadLossReason)
  lossReason?: LeadLossReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  lossNotes?: string;

  /**
   * Lets the board's contextual modal send the missing budget/timeline/
   * requirement answers together with the drop, so moving a card to
   * "Qualified" stays one action instead of a drop followed by a separate
   * form submit.
   */
  // @Type is required, not decorative: the global ValidationPipe runs with
  // whitelist + forbidNonWhitelisted, and without the explicit target type
  // the nested object stays a plain object whose properties are all treated
  // as non-whitelisted, so a valid payload is rejected with a 400.
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateQualificationDto)
  qualification?: UpdateQualificationDto;
}
