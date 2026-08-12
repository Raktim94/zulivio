import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { Role } from "@prisma/client";

export class CreateTrainingAssignmentDto {
  @IsString()
  documentId!: string;

  @IsOptional()
  @IsEnum(Role)
  targetRole?: Role;

  @IsOptional()
  @IsString()
  targetEmployeeId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
