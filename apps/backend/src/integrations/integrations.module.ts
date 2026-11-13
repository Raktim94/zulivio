import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { IntegrationsAdminController, HumanSessionOnly } from "./admin.controllers";
import { CredentialsService } from "./credentials.service";
import { IntegrationAuthGuard } from "./integration-auth.guard";
import { ExtController, TelephonyReceiverController } from "./receiver-and-ext.controllers";
import { TelephonyService } from "./telephony.service";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [LeadsModule],
  controllers: [IntegrationsAdminController, TelephonyReceiverController, ExtController],
  providers: [CredentialsService, WebhooksService, TelephonyService, IntegrationAuthGuard, HumanSessionOnly],
})
export class IntegrationsModule {}
