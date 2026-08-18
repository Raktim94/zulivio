import { Module } from "@nestjs/common";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";
import { AssignmentsModule } from "../assignments/assignments.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { ReportsModule } from "../reports/reports.module";
import { QualityAuditsModule } from "../quality-audits/quality-audits.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { LeadsModule } from "../leads/leads.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { TipsModule } from "../tips/tips.module";

@Module({
  imports: [
    AssignmentsModule,
    AttendanceModule,
    ReportsModule,
    QualityAuditsModule,
    WorkflowsModule,
    LeadsModule,
    KnowledgeModule,
    TipsModule,
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
