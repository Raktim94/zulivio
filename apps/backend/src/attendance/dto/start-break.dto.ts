import { IsOptional, IsString } from "class-validator";

export class StartBreakDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
