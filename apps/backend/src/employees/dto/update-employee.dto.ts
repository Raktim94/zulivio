import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { EmploymentStatus, Role } from "@prisma/client";

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  department?: string;

  /** Pass an empty string to clear the manager assignment. */
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;
}
