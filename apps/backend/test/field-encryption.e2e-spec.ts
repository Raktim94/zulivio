import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FieldEncryptionService } from "../src/common/crypto/field-encryption.service";

// Not a real e2e test (no app/DB needed) — named *.e2e-spec.ts anyway since
// that's the only test glob this project's jest config picks up (see
// test/jest-e2e.json). Covers the security-critical primitive backing
// BackupConfig.secretAccessKey encryption at rest (SECURITY_AUDIT_REPORT.md
// finding #10) directly, rather than through a full S3-dependent flow.
describe("FieldEncryptionService", () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;
  const originalKeyPath = process.env.FIELD_ENCRYPTION_KEY_PATH;
  let tmpDir: string;
  let service: FieldEncryptionService;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "field-encryption-test-"));
    process.env.FIELD_ENCRYPTION_KEY_PATH = path.join(tmpDir, "field-encryption.key");
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    service = new FieldEncryptionService();
  });

  afterAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
    process.env.FIELD_ENCRYPTION_KEY_PATH = originalKeyPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a value through encrypt/decrypt", () => {
    const plaintext = "AKIAIOSFODNN7EXAMPLE-secret-access-key";
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext));
  });

  it("passes through legacy plaintext values unchanged", () => {
    const legacyPlaintextRow = "this-was-never-encrypted";
    expect(service.decrypt(legacyPlaintextRow)).toBe(legacyPlaintextRow);
  });

  it("rejects a tampered ciphertext instead of returning corrupted data", () => {
    const encrypted = service.encrypt("real-secret");
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it("auto-generates and persists a key when FIELD_ENCRYPTION_KEY is missing", () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const freshService = new FieldEncryptionService();

    const encrypted = freshService.encrypt("no-env-var-needed");
    expect(freshService.decrypt(encrypted)).toBe("no-env-var-needed");

    // A second instance picks up the same persisted key from disk, so
    // values encrypted before a restart still decrypt after one.
    const restartedService = new FieldEncryptionService();
    expect(restartedService.decrypt(encrypted)).toBe("no-env-var-needed");

    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("throws a clear error when FIELD_ENCRYPTION_KEY is the wrong length", () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => service.encrypt("x")).toThrow(/32 bytes/);
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
});
