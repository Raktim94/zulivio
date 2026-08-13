import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// Audit events can include operational history a lower-ranked employee
// shouldn't see (password resets, role changes, removals) — restricted to
// the Master Owner, same tier as Settings/Backups.
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.MASTER_OWNER)
@Controller("api/v1/audit-events")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@CurrentEmployee() actor: AuthenticatedEmployee, @Query("limit") limit?: string) {
    return this.auditService.list(actor, limit ? Number(limit) : undefined);
  }
}
