import { IsEnum, IsOptional, IsString } from "class-validator";
import { ForecastCategory } from "@prisma/client";

export class SetForecastCategoryDto {
  @IsEnum(ForecastCategory)
  category!: ForecastCategory;

  @IsOptional()
  @IsString()
  reason?: string;
}
