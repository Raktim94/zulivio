import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { MobileAdminController } from "./mobile-admin.controller";
import { MobileCallsQueryService } from "./mobile-calls-query.service";
import { MobileCallsService } from "./mobile-calls.service";
import { MobileDeviceGuard } from "./mobile-device.guard";
import { MobileDevicesService } from "./mobile-devices.service";
import { MobileIngestController } from "./mobile-ingest.controller";
import { MobileRetentionService } from "./mobile-retention.service";

@Module({
  imports: [LeadsModule, PipelinesModule],
  controllers: [MobileIngestController, MobileAdminController],
  providers: [MobileCallsService, MobileCallsQueryService, MobileDevicesService, MobileDeviceGuard, MobileRetentionService],
})
export class MobileCallsModule {}
