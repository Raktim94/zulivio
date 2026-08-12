import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { TipsService } from "./tips.service";
import { CreateTipDto } from "./dto/create-tip.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/tips")
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  @Get("feed")
  async feed(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.tipsService.feed(actor);
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateTipDto) {
    return this.tipsService.create(actor, dto);
  }

  @Post(":id/acknowledge")
  async acknowledge(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.tipsService.acknowledge(actor, id);
  }
}
