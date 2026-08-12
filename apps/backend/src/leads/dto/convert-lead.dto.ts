import { IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class ConvertLeadDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @IsOptional()
  @IsString()
  pipelineId?: string;
}
