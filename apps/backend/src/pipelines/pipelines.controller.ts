import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PipelineKind } from "@prisma/client";
import { PipelinesService } from "./pipelines.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/pipelines")
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  /**
   * `kind` is optional and defaults to OPPORTUNITY, so the response for an
   * existing caller that passes nothing is byte-for-byte what it was before
   * lead pipelines existed.
   */
  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee, @Query("kind") kind?: string) {
    const resolved = kind === PipelineKind.LEAD ? PipelineKind.LEAD : PipelineKind.OPPORTUNITY;
    return this.pipelinesService.list(actor, resolved);
  }
}
