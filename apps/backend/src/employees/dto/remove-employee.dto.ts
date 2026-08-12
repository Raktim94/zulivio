import { IsOptional, IsString } from "class-validator";

export class RemoveEmployeeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
