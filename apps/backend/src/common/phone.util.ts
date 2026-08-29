/**
 * Cleans a phone-like value from any entry point (CSV import, the manual
 * lead form, the Submify API integration) into digits-only text, keeping a
 * leading "+" if the source had one and keeping the number's full length
 * (including any country code). This is what gets stored on `Lead.phone`
 * and used for the click-to-call `tel:` link, so it must stay dialable —
 * see `phoneLast10` below for a country-code-agnostic value instead.
 *
 * Fixes the concrete real-world mess this app hit: Excel/Sheets auto-
 * formats a numeric-looking, unquoted cell as a Number, and once it has
 * more digits than "General" format displays plainly, it renders — and, if
 * re-saved as CSV, is written — as e.g. "9.18605E+11" instead of the
 * original digits. This reconstructs the integer from that notation before
 * stripping any other punctuation/spacing.
 *
 * Note: if a source file's phone column was already collapsed into
 * scientific notation with fewer significant digits than the real number
 * had (e.g. "9.18605E+11" has only 6) before it reached us, those trailing
 * digits were already lost at that point — this can zero-pad the
 * reconstruction but can't recover digits that were never in the file.
 */
export function normalizePhone(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const scientificNotation = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;
  if (scientificNotation.test(trimmed)) {
    const asNumber = Number(trimmed);
    const digits = Number.isFinite(asNumber) ? Math.trunc(Math.abs(asNumber)).toString() : trimmed.replace(/\D/g, "");
    return digits || undefined;
  }

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  return hadPlus ? `+${digits}` : digits;
}

/**
 * A country-code-agnostic matching key: the last 10 digits of a phone
 * number, used for de-duplication and lookups (e.g. Agent Assist's
 * caller-ID lookup) so a lead can be found regardless of whether it or the
 * search value carries a country code, a "00"/"0" trunk prefix, or
 * punctuation.
 */
export function phoneLast10(raw: string | null | undefined): string | undefined {
  const cleaned = normalizePhone(raw);
  if (!cleaned) return undefined;
  const digits = cleaned.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
