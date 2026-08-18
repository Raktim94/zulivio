import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapDto } from "./dto/bootstrap.dto";
import { Public } from "../common/decorators/public.decorator";

@Controller("api/v1/bootstrap")
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Public()
  @Post()
  async bootstrap(@Body() dto: BootstrapDto, @Req() req: Request) {
    return this.bootstrapService.bootstrap(dto, req.ip);
  }
}
