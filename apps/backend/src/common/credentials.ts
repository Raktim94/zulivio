import { randomInt } from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/l/I) so temporary passwords are typeable.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";

/** Generates a random, human-typeable temporary password. Never persisted in plaintext. */
export function generateTemporaryPassword(length = 14): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Generates a per-organization sequential employee number, e.g. EMP-0007. */
export function formatEmployeeNumber(sequence: number, prefix = "EMP"): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}
