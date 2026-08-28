import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { EmployeesService } from "./employees.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { RemoveEmployeeDto } from "./dto/remove-employee.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard, RolesGuard)
@Controller("api/v1/employees")
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.employeesService.list(actor);
  }

  @Get("me")
  me(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return actor;
  }

  @Roles(Role.MANAGER)
  @Post()
  async create(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(actor, dto);
  }

  @Roles(Role.MANAGER)
  @Patch(":id")
  async update(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(actor, id, dto);
  }

  @Roles(Role.MANAGER)
  @Post(":id/reset-password")
  async resetPassword(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.employeesService.resetPassword(actor, id);
  }

  @Roles(Role.MANAGER)
  @Delete(":id")
  async remove(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: RemoveEmployeeDto,
  ) {
    return this.employeesService.remove(actor, id, dto.reason);
  }

  @Roles(Role.MANAGER)
  @Delete(":id/permanent")
  async purge(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.employeesService.purge(actor, id);
  }
}
