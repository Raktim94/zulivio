import { IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class CreateWorkflowDefinitionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** [{ id, title, body, fields: [{ id, label, type, required }] }] */
  @IsArray()
  steps!: unknown[];
}
