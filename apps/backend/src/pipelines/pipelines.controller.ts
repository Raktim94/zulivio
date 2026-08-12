import { Controller, Get, UseGuards } from "@nestjs/common";
import { PipelinesService } from "./pipelines.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/pipelines")
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.pipelinesService.list(actor);
  }
}
