import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Free-text territory tag (e.g. region/state) used by TERRITORY-mode assignment rules. */
  @IsOptional()
  @IsString()
  territory?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  /** If true and no ownerId was given, run the org's active assignment rule. */
  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;
}
