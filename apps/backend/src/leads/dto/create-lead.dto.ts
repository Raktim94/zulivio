import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from "class-validator";
import { LeadPriority } from "@prisma/client";

/**
 * Backward compatibility note: every field added by the telecalling CRM
 * work is optional. The pre-existing contract (fullName required; email,
 * phone, company, source, notes, territory, ownerId, autoAssign optional)
 * is unchanged, because an external integration (Submify) posts to
 * POST /api/v1/leads in production against exactly that shape. Never make
 * a new field required here, and never remove one of the originals.
 */
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

  // --- Added by the telecalling CRM work; all optional. ---

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jobTitle?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  campaign?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  /** Import-derived columns with no dedicated field (e.g. a scraped-lead CSV's rating/category). */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}
