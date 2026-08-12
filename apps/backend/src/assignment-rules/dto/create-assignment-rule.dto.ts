import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateAssignmentRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  memberIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  slaMinutes?: number;
}
