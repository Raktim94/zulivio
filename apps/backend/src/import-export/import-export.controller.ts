import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ImportExportService } from "./import-export.service";
import { GoogleSheetsSyncDto } from "./dto/google-sheets-sync.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1")
export class ImportExportController {
  constructor(private readonly importExportService: ImportExportService) {}

  @Get("exports/employees.csv")
  @Header("Content-Type", "text/csv")
  async exportEmployees(@CurrentEmployee() actor: AuthenticatedEmployee, @Res() res: Response) {
    const csv = await this.importExportService.exportEmployeesCsv(actor);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="employees-${Date.now()}.csv"`,
    );
    res.send(csv);
  }

  @Get("exports/assignments.csv")
  @Header("Content-Type", "text/csv")
  async exportAssignments(@CurrentEmployee() actor: AuthenticatedEmployee, @Res() res: Response) {
    const csv = await this.importExportService.exportAssignmentsCsv(actor);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="assignments-${Date.now()}.csv"`,
    );
    res.send(csv);
  }

  @Post("imports/employees/csv")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async importEmployees(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.importExportService.importEmployeesCsv(actor, file.buffer.toString("utf-8"));
  }

  @Get("integrations/google-sheets/status")
  status() {
    return this.importExportService.googleSheetsStatus();
  }

  @Post("integrations/google-sheets/export")
  async exportToSheets(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: GoogleSheetsSyncDto,
  ) {
    return this.importExportService.exportToGoogleSheets(actor, dto);
  }

  @Post("integrations/google-sheets/import")
  async importFromSheets(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: GoogleSheetsSyncDto,
  ) {
    return this.importExportService.importFromGoogleSheets(actor, dto);
  }
}
