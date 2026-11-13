import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateCredentialDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) scopes!: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) expiresInDays?: number;
}

export class CreateWebhookDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MaxLength(2000) url!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) events!: string[];
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) events?: string[];
  @IsOptional() @IsIn(["active", "paused"]) status?: "active" | "paused";
}

export class PageQuery {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreateProviderDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsIn(["GENERIC_WEBHOOK"]) kind?: "GENERIC_WEBHOOK";
  @IsOptional() @IsIn(["hmac", "token"]) auth?: "hmac" | "token";
  @IsOptional() @IsObject() fields?: Record<string, string>;
  @IsOptional() @IsObject() statusMap?: Record<string, string>;
}

export class UpdateProviderDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(["hmac", "token"]) auth?: "hmac" | "token";
  @IsOptional() @IsObject() fields?: Record<string, string>;
  @IsOptional() @IsObject() statusMap?: Record<string, string>;
}

export class TestProviderDto {
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

export class ExtCreateLeadDto {
  @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

export class ExtListQuery {
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(40) updatedSince?: string;
}

export class ExtCallDto {
  @IsString() @MinLength(1) @MaxLength(100) provider_call_id!: string;
  @IsIn(["started", "answered", "completed", "missed"]) event_type!: "started" | "answered" | "completed" | "missed";
  @IsIn(["inbound", "outbound"]) direction!: "inbound" | "outbound";
  @IsString() @MaxLength(32) phone_number!: string;
  @IsOptional() @IsString() @MaxLength(40) started_at?: string;
  @IsOptional() @IsString() @MaxLength(40) ended_at?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(86400) duration_seconds?: number;
  @IsOptional() @IsString() @MaxLength(254) agent_email?: string;
}
