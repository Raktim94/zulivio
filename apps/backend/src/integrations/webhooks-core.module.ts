import { Global, Module } from "@nestjs/common";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

/** Global so any service can `emit` an event without importing the integrations module (and its controllers). */
@Global()
@Module({ providers: [WebhookDispatcher], exports: [WebhookDispatcher] })
export class WebhooksCoreModule {}
