import { IsBoolean } from "class-validator";

export class SetActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
