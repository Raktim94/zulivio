import { createHash, randomBytes } from "node:crypto";

export const MOBILE_ACCESS_PREFIX = "zla_";
export const MOBILE_REFRESH_PREFIX = "zlr_";

/** 15 minutes: a stolen access token is only useful briefly, and revocation also takes effect immediately (it is looked up per request). */
export const MOBILE_ACCESS_TTL_MS = 15 * 60 * 1000;
/** 30 days, single-use, rotated on every refresh. */
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Tokens are 192 bits of CSPRNG output, so a plain SHA-256 is the right lookup hash (same as Session/ApiKey). */
export function hashMobileToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newMobileToken(prefix: string): { raw: string; hash: string } {
  const raw = prefix + randomBytes(24).toString("base64url");
  return { raw, hash: hashMobileToken(raw) };
}
