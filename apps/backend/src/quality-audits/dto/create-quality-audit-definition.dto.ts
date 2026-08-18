import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class CreateQualityAuditDefinitionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** [{ id, name, maxScore, criteria: [{ id, label, maxScore }] }] */
  @IsArray()
  sections!: unknown[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
