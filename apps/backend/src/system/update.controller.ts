import { Controller, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { UpdateService } from "./update.service";

// Deliberately a separate controller from VersionController: the version
// *check* is @Public (harmless to expose, drives the sidebar badge), but
// *applying* an update restarts the whole stack and must be gated the same
// way backups are — Master-Owner only.
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.MASTER_OWNER)
@Controller("api/v1/system")
export class UpdateController {
  constructor(private readonly updateService: UpdateService) {}

  @Post("update/apply")
  async apply() {
    return this.updateService.applyUpdate();
  }
}
