import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Injectable, InternalServerErrorException } from "@nestjs/common";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PREFIX = "v1:";
const KEY_BYTES = 32;

/**
 * Envelope encryption for secrets stored at rest in Postgres (S3 backup
 * credentials, Google Sheets service-account keys, etc.) — DB read access
 * (including a raw pg_dump) should not hand over live third-party
 * credentials in plaintext.
 *
 * Key resolution, checked in order:
 *  1. FIELD_ENCRYPTION_KEY env var (32 raw bytes, base64) — explicit
 *     override, e.g. pinning the same key across multiple instances or
 *     restoring a backup onto a fresh volume.
 *  2. A key file on disk at FIELD_ENCRYPTION_KEY_PATH (default
 *     <cwd>/data/field-encryption.key), generated the first time it's
 *     needed. This is what makes the feature work with zero manual setup —
 *     as long as that path lives on a persisted volume, the same key
 *     survives restarts.
 * The key itself is never stored in the database.
 *
 * decrypt() treats any value without the "v1:" prefix as legacy plaintext
 * and returns it unchanged, so existing rows written before this service
 * existed keep working without a data migration — they're re-encrypted
 * automatically the next time that row is saved through the app.
 */
@Injectable()
export class FieldEncryptionService {
  private keyFilePath(): string {
    return process.env.FIELD_ENCRYPTION_KEY_PATH ?? path.join(process.cwd(), "data", "field-encryption.key");
  }

  private loadOrCreatePersistedKey(): Buffer {
    const filePath = this.keyFilePath();
    if (existsSync(filePath)) {
      const key = Buffer.from(readFileSync(filePath, "utf8").trim(), "base64");
      if (key.length !== KEY_BYTES) {
        throw new InternalServerErrorException(
          `Persisted encryption key at ${filePath} is corrupt (expected ${KEY_BYTES} raw bytes, base64-encoded). ` +
            "Restore it from backup, or delete the file to generate a new one — note any already-encrypted fields " +
            "will no longer decrypt with a newly generated key.",
        );
      }
      return key;
    }

    const key = randomBytes(KEY_BYTES);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, key.toString("base64"), { mode: 0o600 });
    return key;
  }

  private getKey(): Buffer {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (raw) {
      const key = Buffer.from(raw, "base64");
      if (key.length !== KEY_BYTES) {
        throw new InternalServerErrorException(
          "FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes — generate one with `openssl rand -base64 32`.",
        );
      }
      return key;
    }

    return this.loadOrCreatePersistedKey();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString("base64")}.${authTag.toString("base64")}.${ciphertext.toString("base64")}`;
  }

  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value;

    const [ivB64, authTagB64, ciphertextB64] = value.slice(PREFIX.length).split(".");
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new InternalServerErrorException("Malformed encrypted field value");
    }

    const decipher = createDecipheriv(ALGORITHM, this.getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
