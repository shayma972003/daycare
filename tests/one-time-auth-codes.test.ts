import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hashOneTimeCode,
  isVersionedOneTimeCodeHash,
  oneTimeCodeMatches,
  rateLimitSubject,
} from "@/lib/one-time-code";

describe("one-time-code hashing", () => {
  beforeEach(() => {
    vi.stubEnv("OTP_HASH_PEPPER", "test-otp-pepper-that-is-at-least-32-characters");
  });

  it("stores a versioned HMAC rather than the plaintext or an unkeyed digest", async () => {
    const code = "123456";
    const stored = hashOneTimeCode(code, "password-reset");

    expect(isVersionedOneTimeCodeHash(stored)).toBe(true);
    expect(stored).not.toContain(code);
    expect(stored).not.toBe(createHash("sha256").update(code).digest("hex"));
    await expect(oneTimeCodeMatches(stored, code, "password-reset")).resolves.toBe(true);
    await expect(oneTimeCodeMatches(stored, "654321", "password-reset")).resolves.toBe(false);
  });

  it("separates purposes and requires the same pepper", async () => {
    const stored = hashOneTimeCode("123456", "2fa-login");
    await expect(oneTimeCodeMatches(stored, "123456", "2fa-activate")).resolves.toBe(false);
    vi.stubEnv("OTP_HASH_PEPPER", "different-test-pepper-that-is-at-least-32-chars");
    await expect(oneTimeCodeMatches(stored, "123456", "2fa-login")).resolves.toBe(false);
  });

  it("limits legacy unkeyed compatibility to the documented cutoff", async () => {
    const legacy = createHash("sha256").update("123456").digest("hex");
    await expect(
      oneTimeCodeMatches(legacy, "123456", "password-reset", new Date("2026-08-20"))
    ).resolves.toBe(true);
    await expect(
      oneTimeCodeMatches(legacy, "123456", "password-reset", new Date("2026-09-01"))
    ).resolves.toBe(false);
  });

  it("turns identifying limiter inputs into opaque stable subjects", () => {
    const subject = rateLimitSubject("Person@Example.test");
    expect(subject).toBe(rateLimitSubject("person@example.test"));
    expect(subject).not.toContain("person");
    expect(subject).toHaveLength(32);
  });
});
