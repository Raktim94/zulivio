import { IsDateString, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateAssignmentDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsIn(["low", "normal", "high", "urgent"])
  priority?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
