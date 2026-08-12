import { Body, Controller, Post } from "@nestjs/common";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapDto } from "./dto/bootstrap.dto";

@Controller("api/v1/bootstrap")
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post()
  async bootstrap(@Body() dto: BootstrapDto) {
    return this.bootstrapService.bootstrap(dto);
  }
}
