import { Type } from "class-transformer";
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

export class DeviceInfoDto {
  /** Random id the app generated on first launch (never a hardware identifier). */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{16,64}$/, { message: "installId must be 16-64 letters, digits or dashes" })
  installId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  appVersion?: string;
}

export class MobileLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device!: DeviceInfoDto;
}

export class MobileRefreshDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  refreshToken!: string;
}

export class MobileLogoutDto {
  /** Also delete the phone contacts this device uploaded. */
  @IsOptional()
  @IsBoolean()
  purgeContacts?: boolean;
}
