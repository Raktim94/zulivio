import { IsIn, IsString, MinLength } from "class-validator";

export class GoogleSheetsSyncDto {
  @IsString()
  @MinLength(1)
  spreadsheetId!: string;

  @IsString()
  @MinLength(1)
  range!: string;

  @IsIn(["employees", "assignments"])
  object!: "employees" | "assignments";
}
