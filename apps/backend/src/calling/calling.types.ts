/**
 * The seam a real dialer plugs into later.
 *
 * Cloud telephony (SIP trunks, browser softphones, power/predictive
 * dialing, call recording, IVR and queues) is explicitly out of scope for
 * this release — see docs/decisions/0001-telecalling-crm.md. What ships now
 * is the *interface* plus a manual provider, so adding a real provider is a
 * new class registered against CALL_PROVIDER and nothing else in the leads
 * module changes.
 */
export interface PlaceCallRequest {
  leadId: string;
  phone: string;
  /** The employee initiating the call — a real provider needs it to pick an agent extension. */
  agentId: string;
}

export interface PlaceCallResult {
  /**
   * "manual"  — the client dials it itself (a tel: URI); the app records the
   *             activity when the telecaller submits a disposition.
   * "bridged" — the provider placed the call server-side and will report
   *             the outcome back; `externalCallId` identifies it.
   */
  mode: "manual" | "bridged";
  /** Client-side dial target, e.g. "tel:+919000000000". Null for bridged providers. */
  dialUri: string | null;
  externalCallId: string | null;
  provider: string;
}

export interface CallProvider {
  readonly name: string;
  placeCall(request: PlaceCallRequest): Promise<PlaceCallResult>;
}

/** Nest DI token — inject with `@Inject(CALL_PROVIDER)`. */
export const CALL_PROVIDER = Symbol("CALL_PROVIDER");
