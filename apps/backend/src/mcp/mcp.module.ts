import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpToolsBuilder } from "./mcp-tools.builder";
import { EmployeesModule } from "../employees/employees.module";
import { LeadsModule } from "../leads/leads.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { AssignmentsModule } from "../assignments/assignments.module";
import { ReportsModule } from "../reports/reports.module";

@Module({
  imports: [EmployeesModule, LeadsModule, AttendanceModule, AssignmentsModule, ReportsModule],
  controllers: [McpController],
  providers: [McpToolsBuilder],
})
export class McpModule {}
