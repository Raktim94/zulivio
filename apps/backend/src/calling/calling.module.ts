import { Module } from "@nestjs/common";
import { CALL_PROVIDER } from "./calling.types";
import { ManualCallProvider } from "./manual-call.provider";

/**
 * Swapping in a real dialer is a one-line change here — bind CALL_PROVIDER
 * to the new class. Nothing in the leads module knows which provider it is
 * talking to.
 */
@Module({
  providers: [ManualCallProvider, { provide: CALL_PROVIDER, useExisting: ManualCallProvider }],
  exports: [CALL_PROVIDER],
})
export class CallingModule {}
