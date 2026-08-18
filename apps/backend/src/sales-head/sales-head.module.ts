import { Module } from "@nestjs/common";
import { SalesHeadController } from "./sales-head.controller";
import { SalesHeadService } from "./sales-head.service";
import { AttendanceModule } from "../attendance/attendance.module";

@Module({
  imports: [AttendanceModule],
  controllers: [SalesHeadController],
  providers: [SalesHeadService],
})
export class SalesHeadModule {}
