import { IsString, MaxLength, MinLength } from "class-validator";

export class IssueApiKeyDto {
  @IsString()
  @MinLength(1)
  employeeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}
