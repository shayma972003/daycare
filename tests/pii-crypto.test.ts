import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptPii,
  encryptPii,
  protectIdNumber,
} from "@/lib/pii-crypto";

const originalEncryptionKey = process.env.PII_ENCRYPTION_KEY;
const originalIndexPepper = process.env.PII_INDEX_PEPPER;

function configureKeys() {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString("base64");
}

beforeEach(configureKeys);

afterEach(() => {
  if (originalEncryptionKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalIndexPepper === undefined) delete process.env.PII_INDEX_PEPPER;
  else process.env.PII_INDEX_PEPPER = originalIndexPepper;
  vi.unstubAllEnvs();
});

describe("PII encryption", () => {
  it("encrypts and decrypts with the configured key", () => {
    const plaintext = "1098765432";
    const encrypted = encryptPii(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptPii(encrypted)).toBe(plaintext);
  });

  it("prepares storage without retaining the original value", () => {
    const plaintext = "1098765432";
    const protectedValue = protectIdNumber(plaintext);

    expect(protectedValue.idNumber).toBeNull();
    expect(protectedValue.encryptedIdNumber).not.toContain(plaintext);
    expect(JSON.stringify(protectedValue)).not.toContain(plaintext);
    expect(decryptPii(protectedValue.encryptedIdNumber)).toBe(plaintext);
  });

  it("rejects a wrong key", () => {
    const encrypted = encryptPii("1098765432");
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expect(decryptPii(encrypted)).toBeNull();
  });

  it("rejects modified ciphertext", () => {
    const parts = encryptPii("1098765432").split(".");
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;

    expect(decryptPii(parts.join("."))).toBeNull();
  });

  it("keeps development usable but fails closed for non-empty IDs without keys", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_INDEX_PEPPER;

    expect(protectIdNumber(null)).toEqual({
      idNumber: null,
      encryptedIdNumber: null,
      idNumberHash: null,
    });
    expect(() => protectIdNumber("1098765432")).toThrow(/Cannot store an ID number/);
  });
});

describe("production environment validation", () => {
  it("fails startup when either PII secret is missing", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@example.test/database");
    vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32));
    vi.stubEnv("NEXTAUTH_URL", "https://example.test");
    vi.stubEnv("ADMIN_JWT_SECRET", "a".repeat(32));
    vi.stubEnv("PII_ENCRYPTION_KEY", "");
    vi.stubEnv("PII_INDEX_PEPPER", "");

    try {
      await expect(import("@/lib/env")).rejects.toThrow(/PII_ENCRYPTION_KEY is required in production/);
      await expect(import("@/lib/env")).rejects.toThrow(/PII_INDEX_PEPPER is required in production/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
