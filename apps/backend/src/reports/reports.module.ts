import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { CrmReportsService } from "./crm-reports.service";
import { AttendanceModule } from "../attendance/attendance.module";

@Module({
  imports: [AttendanceModule],
  controllers: [ReportsController],
  providers: [ReportsService, CrmReportsService],
  exports: [ReportsService, CrmReportsService],
})
export class ReportsModule {}
