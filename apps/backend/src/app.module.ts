import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthGuard } from "./common/guards/auth.guard";
import { ScopeModule } from "./common/scope.module";
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
import { BackupModule } from "./backup/backup.module";
import { AuditModule } from "./audit/audit.module";
import { QualityAuditsModule } from "./quality-audits/quality-audits.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { MeModule } from "./me/me.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ScopeModule,
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
    BackupModule,
    AuditModule,
    QualityAuditsModule,
    WorkflowsModule,
    MeModule,
  ],
  providers: [
    // Global safety net: every route requires an authenticated session
    // unless explicitly opted out with @Public(). Previously AuthGuard was
    // applied per-controller, so a new controller that forgot @UseGuards
    // was silently unprotected — see SECURITY_AUDIT_REPORT.md.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
