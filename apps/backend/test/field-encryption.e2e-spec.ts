import { FieldEncryptionService } from "../src/common/crypto/field-encryption.service";

// Not a real e2e test (no app/DB needed) — named *.e2e-spec.ts anyway since
// that's the only test glob this project's jest config picks up (see
// test/jest-e2e.json). Covers the security-critical primitive backing
// BackupConfig.secretAccessKey encryption at rest (SECURITY_AUDIT_REPORT.md
// finding #10) directly, rather than through a full S3-dependent flow.
describe("FieldEncryptionService", () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;
  let service: FieldEncryptionService;

  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    service = new FieldEncryptionService();
  });

  afterAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
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

  it("throws a clear error when FIELD_ENCRYPTION_KEY is missing", () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(() => service.encrypt("x")).toThrow(/FIELD_ENCRYPTION_KEY/);
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("throws a clear error when FIELD_ENCRYPTION_KEY is the wrong length", () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => service.encrypt("x")).toThrow(/32 bytes/);
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
});
