import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { ConvertLeadDto } from "./dto/convert-lead.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  async list(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Query("status") status?: LeadStatus,
    @Query("overdue") overdue?: string,
  ) {
    return this.leadsService.list(actor, { status, overdue: overdue === "true" });
  }

  @Get(":id")
  async get(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.leadsService.get(actor, id);
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(actor, dto);
  }

  @Patch(":id")
  async update(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(actor, id, dto);
  }

  @Post(":id/convert")
  async convert(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leadsService.convert(actor, id, dto);
  }
}
