import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { MobileDeviceGuard } from "../mobile-calls/mobile-device.guard";
import { MobileContactsController } from "./mobile-contacts.controller";
import { MobileContactsService } from "./mobile-contacts.service";

@Module({
  imports: [LeadsModule],
  controllers: [MobileContactsController],
  providers: [MobileContactsService, MobileDeviceGuard],
  exports: [MobileContactsService],
})
export class MobileContactsModule {}
