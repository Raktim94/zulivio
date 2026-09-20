import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { IssueApiKeyDto } from "./dto/issue-api-key.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// The self-service routes below carry no @Roles gate: every employee
// manages their own personal keys only — ApiKeysService scopes every
// read/write to actor.id, enforced at the service layer (defense in depth,
// same convention as backup/backup.controller.ts). The /org routes are the
// MASTER_OWNER-only exception: provisioning and revoking a key *for*
// another employee (e.g. a MacroDroid device token — see missed-calls/).
@UseGuards(AuthGuard, RolesGuard)
@Controller("api/v1/api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.apiKeysService.list(actor);
  }

  @Post()
  async create(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(actor, dto);
  }

  @Delete(":id")
  async revoke(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.apiKeysService.revoke(actor, id);
  }

  @Roles(Role.MASTER_OWNER)
  @Get("org")
  async listForOrg(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.apiKeysService.listForOrg(actor);
  }

  @Roles(Role.MASTER_OWNER)
  @Post("org")
  async issueForOrg(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: IssueApiKeyDto) {
    return this.apiKeysService.issueFor(actor, dto);
  }

  @Roles(Role.MASTER_OWNER)
  @Delete("org/:id")
  async revokeForOrg(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.apiKeysService.revokeForOrg(actor, id);
  }
}
