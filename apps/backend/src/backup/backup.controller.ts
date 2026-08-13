import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { BackupService } from "./backup.service";
import { RestoreBackupDto } from "./dto/restore-backup.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// Backups span the whole instance (every organization sharing this
// database), so visibility is restricted well above the usual manager
// tier: any read leaks the existence/timing of a full-instance dump, and
// triggering one or restoring is deliberately Master-Owner-only (enforced
// again at the service layer, since restore is destructive enough to
// warrant defense in depth).
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.MASTER_OWNER)
@Controller("api/v1/backups")
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get("status")
  async status() {
    return this.backupService.status();
  }

  @Get()
  async list() {
    return this.backupService.list();
  }

  @Post()
  async triggerManual(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.backupService.triggerManual(actor);
  }

  @Post(":id/restore")
  async restore(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() dto: RestoreBackupDto,
  ) {
    return this.backupService.restore(actor, id, dto.confirm);
  }
}
