import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { AssignmentRulesModule } from "../assignment-rules/assignment-rules.module";
import { PipelinesModule } from "../pipelines/pipelines.module";

@Module({
  imports: [AssignmentRulesModule, PipelinesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
