import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { BootstrapModule } from "./bootstrap/bootstrap.module";
import { AuthModule } from "./auth/auth.module";
import { EmployeesModule } from "./employees/employees.module";
import { AssignmentsModule } from "./assignments/assignments.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { TipsModule } from "./tips/tips.module";
import { ReportsModule } from "./reports/reports.module";
import { ImportExportModule } from "./import-export/import-export.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { AssignmentRulesModule } from "./assignment-rules/assignment-rules.module";
import { LeadsModule } from "./leads/leads.module";
import { OpportunitiesModule } from "./opportunities/opportunities.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    BootstrapModule,
    AuthModule,
    EmployeesModule,
    AssignmentsModule,
    AttendanceModule,
    KnowledgeModule,
    TipsModule,
    ReportsModule,
    ImportExportModule,
    PipelinesModule,
    AssignmentRulesModule,
    LeadsModule,
    OpportunitiesModule,
  ],
})
export class AppModule {}
