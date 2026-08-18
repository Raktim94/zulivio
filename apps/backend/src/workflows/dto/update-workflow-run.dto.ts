import { IsInt, IsObject, IsOptional, Min } from "class-validator";

export class UpdateWorkflowRunDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  currentStepIndex?: number;

  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;
}
