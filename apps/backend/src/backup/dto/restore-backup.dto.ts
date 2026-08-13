import { IsIn, IsString } from "class-validator";

export class RestoreBackupDto {
  /** Must be the literal string "RESTORE" — a deliberate speed bump before a destructive action. */
  @IsString()
  @IsIn(["RESTORE"])
  confirm!: "RESTORE";
}
