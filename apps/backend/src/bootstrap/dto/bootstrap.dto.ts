import { IsEmail, IsString, MinLength } from "class-validator";

export class BootstrapDto {
  @IsString()
  @MinLength(1)
  organizationName!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters" })
  password!: string;
}
