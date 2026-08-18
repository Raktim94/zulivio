import { IsEmail, IsString, MinLength } from "class-validator";

export class SetGoogleSheetsConfigDto {
  @IsEmail()
  clientEmail!: string;

  @IsString()
  @MinLength(1)
  privateKey!: string;
}
