import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { SalesHeadService } from "./sales-head.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/sales-head")
export class SalesHeadController {
  constructor(private readonly salesHead: SalesHeadService) {}

  @Get("employees")
  async directory(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.salesHead.employeeDirectory(actor);
  }

  @Get("employees/:id")
  async detail(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.salesHead.employeeDetail(actor, id);
  }
}
