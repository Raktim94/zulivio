import { IsDateString, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateOpportunityDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @IsOptional()
  @IsString()
  pipelineId?: string;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;
}
