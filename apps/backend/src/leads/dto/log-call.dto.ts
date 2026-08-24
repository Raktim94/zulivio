import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CallDisposition, CallOutcome } from "@prisma/client";

/**
 * One tap from the disposition sheet, plus anything the telecaller typed
 * alongside it. Everything except outcome/disposition is optional so the
 * common case really is a single tap and back to the queue.
 */
export class LogCallDto {
  @IsEnum(CallOutcome)
  outcome!: CallOutcome;

  @IsEnum(CallDisposition)
  disposition!: CallDisposition;

  /** Capped at 8 hours — anything longer is a forgotten timer, not a call. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(28_800)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Schedules a follow-up in the same round trip, so "callback" is one action. */
  @IsOptional()
  @IsDateString()
  followUpAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  followUpNote?: string;
}
