import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Role } from "@prisma/client";
import { BackupService } from "./backup.service";
import { RestoreBackupDto } from "./dto/restore-backup.dto";
import { SetBackupConfigDto } from "./dto/set-backup-config.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// A backup bundle is a small db dump plus (optionally) the uploads
// volume — generous but bounded so a stray huge file upload can't exhaust
// server memory (memoryStorage buffers the whole upload before it reaches
// the handler).
const RESTORE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

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

  @Post("config")
  async setConfig(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: SetBackupConfigDto) {
    return this.backupService.setConfig(actor, dto);
  }

  @Delete("config")
  async clearConfig(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.backupService.clearConfig(actor);
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

  @Get("download")
  async download(@CurrentEmployee() actor: AuthenticatedEmployee, @Res() res: Response) {
    const { buffer, filename } = await this.backupService.createLocalDownload(actor);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post("restore-upload")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: RESTORE_UPLOAD_MAX_BYTES } }))
  async restoreUpload(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("confirm") confirm: string,
  ) {
    if (!file) {
      throw new BadRequestException("Missing backup file (multipart field \"file\")");
    }
    return this.backupService.restoreFromUpload(actor, file.buffer, confirm);
  }
}
