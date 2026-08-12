import { IsEnum, IsOptional, IsString } from "class-validator";
import { AssignmentStatus } from "@prisma/client";

export class TransitionDto {
  @IsEnum(AssignmentStatus)
  toStatus!: AssignmentStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  outcomeNotes?: string;
}
