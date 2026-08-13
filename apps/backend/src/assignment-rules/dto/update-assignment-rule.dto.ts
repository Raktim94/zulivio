import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { AssignmentRuleMode } from "@prisma/client";

export class UpdateAssignmentRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  memberIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  slaMinutes?: number;

  @IsOptional()
  @IsEnum(AssignmentRuleMode)
  mode?: AssignmentRuleMode;

  @IsOptional()
  @IsObject()
  territoryMap?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxOpenLeads?: number;
}
