import { Module } from "@nestjs/common";
import { MissedCallsController } from "./missed-calls.controller";
import { MissedCallsService } from "./missed-calls.service";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [PipelinesModule, LeadsModule],
  controllers: [MissedCallsController],
  providers: [MissedCallsService],
})
export class MissedCallsModule {}
