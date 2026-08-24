import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { FollowUpsController } from "./follow-ups.controller";
import { LeadsService } from "./leads.service";
import { LeadAccessService } from "./lead-access.service";
import { LeadActivityService } from "./lead-activity.service";
import { LeadScoringService } from "./lead-scoring.service";
import { LeadFollowUpsService } from "./lead-follow-ups.service";
import { AssignmentRulesModule } from "../assignment-rules/assignment-rules.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { CallingModule } from "../calling/calling.module";

@Module({
  imports: [AssignmentRulesModule, PipelinesModule, CallingModule],
  controllers: [LeadsController, FollowUpsController],
  providers: [
    LeadsService,
    LeadAccessService,
    LeadActivityService,
    LeadScoringService,
    LeadFollowUpsService,
  ],
  exports: [LeadsService, LeadScoringService, LeadActivityService, LeadFollowUpsService],
})
export class LeadsModule {}
