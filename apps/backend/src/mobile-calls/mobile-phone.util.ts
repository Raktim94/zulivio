/**
 * Phone normalisation for call-history matching.
 *
 * Produces an E.164-style string ("+<country><national>") whenever the input
 * carries enough information to do so reliably, and otherwise falls back to
 * the bare digits. The original value is always stored alongside, so a
 * wrong guess here never destroys data.
 *
 * Deliberately dependency-free (the CRM already matches leads on the last 10
 * digits — see common/phone.util.ts): rules are
 *   +CC…            keep as-is (digits only)
 *   00CC…           international prefix -> +CC…
 *   0 + 10 digits   national trunk prefix -> default country
 *   10 digits       national number -> default country
 *   CC + 10 digits  (length 12 starting with the default CC) -> +CC…
 * The default country calling code comes from DEFAULT_PHONE_COUNTRY_CODE
 * (default "91", India). Anything else (short codes, "private number",
 * odd lengths) is kept as digits and flagged `reliable: false`.
 */
export interface NormalizedPhone {
  original: string;
  normalized: string;
  last10: string;
  reliable: boolean;
}

export const MIN_PHONE_DIGITS = 3;
export const MAX_PHONE_DIGITS = 15; // E.164 maximum

export function defaultCountryCode(): string {
  const raw = (process.env.DEFAULT_PHONE_COUNTRY_CODE ?? "91").replace(/\D/g, "");
  return raw || "91";
}

export function normalizeCallNumber(raw: string): NormalizedPhone | null {
  const original = raw.trim();
  // Only digits and conventional separators are acceptable in a phone field.
  if (!/^[+\d\s().-]+$/.test(original)) return null;

  const hasPlus = original.startsWith("+");
  let digits = original.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS + 4) return null;

  const cc = defaultCountryCode();
  let normalized: string;
  let reliable = true;

  if (hasPlus) {
    normalized = `+${digits}`;
  } else if (digits.startsWith("00") && digits.length > 6) {
    digits = digits.slice(2);
    normalized = `+${digits}`;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    normalized = `+${cc}${digits.slice(1)}`;
  } else if (digits.length === 10) {
    normalized = `+${cc}${digits}`;
  } else if (digits.length === 10 + cc.length && digits.startsWith(cc)) {
    normalized = `+${digits}`;
  } else {
    normalized = digits;
    reliable = false;
  }

  const normalizedDigits = normalized.replace(/\D/g, "");
  if (normalizedDigits.length > MAX_PHONE_DIGITS) return null;

  return {
    original: original.slice(0, 32),
    normalized,
    last10: normalizedDigits.length > 10 ? normalizedDigits.slice(-10) : normalizedDigits,
    // Matching on 10 digits is only meaningful for full-length numbers.
    reliable: reliable && normalizedDigits.length >= 10,
  };
}
