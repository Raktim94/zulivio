import { IsArray, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateQualityAuditResultDto {
  @IsString()
  definitionId!: string;

  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  overallScore!: number;

  /** [{ sectionId, score, criteria: [{ criteriaId, score, note }] }] */
  @IsArray()
  sectionScores!: unknown[];

  @IsOptional()
  @IsString()
  feedback?: string;
}
