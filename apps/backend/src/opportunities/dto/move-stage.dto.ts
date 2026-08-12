import { IsOptional, IsString, MinLength } from "class-validator";

export class MoveStageDto {
  @IsString()
  @MinLength(1)
  stageId!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  lossReason?: string;
}
