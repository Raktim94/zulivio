import { Injectable } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { CallProvider, PlaceCallRequest, PlaceCallResult } from "./calling.types";

/**
 * The default (and, this release, only) provider: the telecaller's own
 * phone or softphone dials the number via a tel: URI, and the app records
 * what happened when they submit a disposition. No telephony vendor, no
 * credentials, no recording — see calling.types.ts for why.
 */
@Injectable()
export class ManualCallProvider implements CallProvider {
  readonly name = "manual";

  // Returns a resolved promise rather than being declared `async`: this
  // provider does no I/O, but the CallProvider contract is async because a
  // real dialer will be. Keeping the signature and dropping the needless
  // `async` satisfies @typescript-eslint/require-await without weakening
  // the seam.
  placeCall(request: PlaceCallRequest): Promise<PlaceCallResult> {
    const normalized = normalizeDialablePhone(request.phone);
    if (!normalized) {
      throw new BadRequestException("Lead has no dialable phone number");
    }

    return Promise.resolve({
      mode: "manual",
      dialUri: `tel:${normalized}`,
      externalCallId: null,
      provider: this.name,
    });
  }
}

/**
 * Strips formatting a human typed (spaces, dashes, brackets) but keeps a
 * leading "+", which is the only character a tel: URI needs beyond digits.
 * Returns null when nothing dialable is left.
 */
export function normalizeDialablePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `${plus}${digits}`;
}
