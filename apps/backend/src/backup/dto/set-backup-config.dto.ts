import { IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from "class-validator";

export class SetBackupConfigDto {
  // A plain string check (not @IsUrl) deliberately, since that validator
  // rejects some valid internal endpoints (bare IPs with a port, etc.);
  // the real validation is the live connectivity check this DTO feeds.
  @IsString()
  @Matches(/^https?:\/\/.+/, { message: "endpoint must start with http:// or https://" })
  endpoint!: string;

  @IsString()
  @MinLength(1)
  bucket!: string;

  @IsString()
  @MinLength(1)
  accessKeyId!: string;

  @IsString()
  @MinLength(1)
  secretAccessKey!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  intervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  retainCount?: number;
}
