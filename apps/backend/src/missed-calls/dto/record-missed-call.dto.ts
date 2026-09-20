import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body MacroDroid's HTTP Request action posts on its "Call Missed" trigger.
 * phoneNumber is the only field the flow actually needs — the rest are
 * kept for the lead/activity record and for telling devices apart in the
 * Settings > Missed Call Capture list.
 */
export class RecordMissedCallDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  callerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  deviceName?: string;
}
