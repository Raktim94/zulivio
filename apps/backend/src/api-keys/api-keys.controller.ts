import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// No @Roles gate: every employee manages their own personal keys only —
// ApiKeysService scopes every read/write to actor.id, enforced at the
// service layer (defense in depth, same convention as backup/backup.controller.ts).
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
}
