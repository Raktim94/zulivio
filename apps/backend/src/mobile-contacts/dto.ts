import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export const MAX_CONTACTS_PER_REQUEST = 200;
/** Optional fields the user may choose to share. Name and phone numbers are always required to identify a contact. */
export const SHAREABLE_FIELDS = ["company", "emails"] as const;
export type ShareableField = (typeof SHAREABLE_FIELDS)[number];

export class ContactInputDto {
  /** The phone's own contact id. Never stored; only a salted hash is kept for re-sync matching. */
  @IsString() @MinLength(1) @MaxLength(128)
  sourceId!: string;

  @IsString() @MaxLength(200)
  displayName!: string;

  @IsOptional() @IsString() @MaxLength(200)
  company?: string;

  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true })
  phones!: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(254, { each: true })
  emails?: string[];
}

export class ContactPreviewDto {
  @IsArray() @ArrayMaxSize(MAX_CONTACTS_PER_REQUEST) @ValidateNested({ each: true }) @Type(() => ContactInputDto)
  contacts!: ContactInputDto[];

  @IsOptional() @IsArray() @IsIn([...SHAREABLE_FIELDS], { each: true })
  fields?: ShareableField[];
}

export class ContactImportItemDto extends ContactInputDto {
  @IsIn(["IMPORT", "LINK", "SKIP"])
  decision!: "IMPORT" | "LINK" | "SKIP";

  @IsOptional() @IsUUID()
  linkLeadId?: string;
}

export class ContactImportDto {
  @IsArray() @ArrayMaxSize(MAX_CONTACTS_PER_REQUEST) @ValidateNested({ each: true }) @Type(() => ContactImportItemDto)
  contacts!: ContactImportItemDto[];

  /** Which optional fields the user agreed to share. Anything else the client sends is discarded. */
  @IsArray() @IsIn([...SHAREABLE_FIELDS], { each: true })
  fields!: ShareableField[];
}

export class ContactListQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
