import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateFollowUpDto {
  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /**
   * Managers/admins may schedule a follow-up for someone on their team; an
   * employee may only schedule for themselves (enforced server-side, not
   * by hiding the field).
   */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class CompleteFollowUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  outcome?: string;
}

export class RescheduleFollowUpDto {
  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
