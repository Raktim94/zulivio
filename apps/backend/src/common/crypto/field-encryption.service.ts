import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Injectable, InternalServerErrorException } from "@nestjs/common";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PREFIX = "v1:";

/**
 * Envelope encryption for secrets stored at rest in Postgres (S3 backup
 * credentials, Google Sheets service-account keys, etc.) — DB read access
 * (including a raw pg_dump) should not hand over live third-party
 * credentials in plaintext. Key comes from FIELD_ENCRYPTION_KEY (32 raw
 * bytes, base64), never stored in the database itself.
 *
 * decrypt() treats any value without the "v1:" prefix as legacy plaintext
 * and returns it unchanged, so existing rows written before this service
 * existed keep working without a data migration — they're re-encrypted
 * automatically the next time that row is saved through the app.
 */
@Injectable()
export class FieldEncryptionService {
  private getKey(): Buffer {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (!raw) {
      throw new InternalServerErrorException(
        "FIELD_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in .env.",
      );
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        "FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes — generate one with `openssl rand -base64 32`.",
      );
    }
    return key;
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
