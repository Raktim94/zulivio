import { Module } from "@nestjs/common";
import { ImportExportController } from "./import-export.controller";
import { ImportExportService } from "./import-export.service";
import { GoogleSheetsService } from "./google-sheets.service";
import { EmployeesModule } from "../employees/employees.module";
import { AssignmentsModule } from "../assignments/assignments.module";

@Module({
  imports: [EmployeesModule, AssignmentsModule],
  controllers: [ImportExportController],
  providers: [ImportExportService, GoogleSheetsService],
})
export class ImportExportModule {}
