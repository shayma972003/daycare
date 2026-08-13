import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPii } from "@/lib/pii-crypto";
import {
  backfillEnrollmentSubmissionIdNumbers,
  protectEnrollmentSubmissionIdNumber,
  revealEnrollmentSubmissionIdNumber,
} from "@/lib/enrollment-submission-pii";

const originalKey = process.env.PII_ENCRYPTION_KEY;
const originalPepper = process.env.PII_INDEX_PEPPER;

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalKey;
  if (originalPepper === undefined) delete process.env.PII_INDEX_PEPPER;
  else process.env.PII_INDEX_PEPPER = originalPepper;
});

describe("EnrollmentSubmission PII", () => {
  it("stores only authenticated ciphertext and a keyed blind index", () => {
    const plaintext = "1098765432";
    const first = protectEnrollmentSubmissionIdNumber(plaintext);
    const second = protectEnrollmentSubmissionIdNumber(plaintext);

    expect(first.id_number).toBeNull();
    expect(JSON.stringify(first)).not.toContain(plaintext);
    expect(first.encrypted_id_number).not.toBe(second.encrypted_id_number);
    expect(first.id_number_hash).toBe(second.id_number_hash);
    expect(decryptPii(first.encrypted_id_number)).toBe(plaintext);
  });

  it("keeps empty input empty and fails closed without keys", () => {
    expect(protectEnrollmentSubmissionIdNumber(" ")).toEqual({
      id_number: null,
      encrypted_id_number: null,
      id_number_hash: null,
    });
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_INDEX_PEPPER;
    expect(() => protectEnrollmentSubmissionIdNumber("1098765432")).toThrow(/unavailable/);
  });

  it("uses plaintext only for legacy rows and rejects tampered ciphertext", () => {
    expect(revealEnrollmentSubmissionIdNumber({
      id_number: "legacy-value",
      encrypted_id_number: null,
    })).toBe("legacy-value");

    const encrypted = protectEnrollmentSubmissionIdNumber("1098765432").encrypted_id_number!;
    expect(revealEnrollmentSubmissionIdNumber({
      id_number: "must-not-fallback",
      encrypted_id_number: `${encrypted.slice(0, -1)}x`,
    })).toBeNull();
  });

  it("backfills with CAS, clears plaintext, and is safely repeatable", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const db = {
      enrollmentSubmission: {
        findMany: vi.fn().mockResolvedValue([
          { id: "legacy-1", id_number: "1098765432" },
          { id: "concurrent-1", id_number: "1087654321" },
        ]),
        updateMany,
      },
      $transaction: vi.fn((callback) => callback({ enrollmentSubmission: { updateMany } })),
    } as never;

    await expect(backfillEnrollmentSubmissionIdNumbers(db, 20)).resolves.toEqual({
      staged: 1,
      skipped: 1,
      failed: 0,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "legacy-1",
        id_number: "1098765432",
        encrypted_id_number: null,
      },
      data: expect.objectContaining({ id_number: null }),
    }));
  });
});
