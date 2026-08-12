import { IsOptional, IsString } from "class-validator";

export class AssignDto {
  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
