import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MobileDeviceStatus } from "@prisma/client";
import { MAX_BULK_CALLS } from "./mobile-call.validation";

export class CreateDeviceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/, { message: "deviceId must be 2-64 chars of letters, digits, _ . -" })
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsUUID()
  employeeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string;
}

export class SetDeviceStatusDto {
  @IsIn(Object.values(MobileDeviceStatus))
  status!: MobileDeviceStatus;
}

export class AttachLeadDto {
  @IsUUID()
  leadId!: string;
}

export class CreateLeadFromCallDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}

export class RetentionDto {
  // null = keep forever.
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  callRetentionDays?: number | null;
}

/** Admin file import: same records the phone would send, authenticated by the admin session. */
export class ImportCallsDto {
  @IsArray()
  @ArrayMaxSize(MAX_BULK_CALLS)
  calls!: Record<string, unknown>[];
}

export class ListCallsQuery {
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @IsUUID() device_id?: string;
  @IsOptional() @IsUUID() lead_id?: string;
  @IsOptional() @IsString() @MaxLength(32) phone_number?: string;
  @IsOptional() @IsString() @MaxLength(80) call_type?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) min_duration?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) max_duration?: number;
  @IsOptional() @IsString() @MaxLength(24) source?: string;
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @Transform(({ value }) => value === "true" || value === true) @IsBoolean() unassigned?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class SummaryQuery {
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class DeleteCallsQuery {
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @IsUUID() device_id?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
