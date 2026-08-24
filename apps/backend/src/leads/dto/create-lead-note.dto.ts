import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { LeadActivityType } from "@prisma/client";

const MANUAL_ACTIVITY_TYPES = [
  LeadActivityType.NOTE,
  LeadActivityType.MESSAGE,
  LeadActivityType.MEETING,
] as const;

export class CreateLeadNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  /**
   * Only the three types a human logs by hand. Every other LeadActivityType
   * (stage changes, calls, follow-up lifecycle) is written by the server as
   * a side effect of the corresponding action, so the timeline can't be
   * forged through this endpoint.
   */
  @IsOptional()
  @IsIn(MANUAL_ACTIVITY_TYPES as readonly string[])
  type?: (typeof MANUAL_ACTIVITY_TYPES)[number];
}
