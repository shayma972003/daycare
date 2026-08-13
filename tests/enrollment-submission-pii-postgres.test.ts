import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.ENROLLMENT_6B3A_SCHEMA;
const connectionString = process.env.DATABASE_URL;
const suite = schema && connectionString ? describe.sequential : describe.skip;
let prisma: PrismaClient;
let pii: typeof import("@/lib/enrollment-submission-pii");

suite("EnrollmentSubmission PII on PostgreSQL", () => {
  beforeAll(async () => {
    if (!schema || !/^codex_6b3a_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe 6B3A schema");
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }, { schema }) });
    pii = await import("@/lib/enrollment-submission-pii");
    await prisma.school.create({ data: { id: "6b3a_canary_school", name: "6B3A Canary" } });
  });

  afterAll(async () => prisma?.$disconnect());

  it("backfills legacy plaintext once and decrypts the result", async () => {
    await expect(pii.backfillEnrollmentSubmissionIdNumbers(prisma, 50)).resolves.toMatchObject({
      staged: 1,
      failed: 0,
    });
    const row = await prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: "6b3a_legacy_submission" } });
    expect(row.id_number).toBeNull();
    expect(row.encrypted_id_number).not.toContain("1098765432");
    expect(row.id_number_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(pii.revealEnrollmentSubmissionIdNumber(row)).toBe("1098765432");
    await expect(pii.backfillEnrollmentSubmissionIdNumbers(prisma, 50)).resolves.toEqual({
      staged: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("uses CAS so concurrent backfills stage one update", async () => {
    await prisma.enrollmentSubmission.create({
      data: {
        id: "6b3a_race_submission",
        token_id: "6b3a_token",
        school_id: "6b3a_school",
        full_name: "Race",
        id_number: "1087654321",
      },
    });
    const results = await Promise.all([
      pii.backfillEnrollmentSubmissionIdNumbers(prisma, 50),
      pii.backfillEnrollmentSubmissionIdNumbers(prisma, 50),
    ]);
    expect(results.reduce((sum, result) => sum + result.staged, 0)).toBe(1);
    const row = await prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: "6b3a_race_submission" } });
    expect(row.id_number).toBeNull();
    expect(pii.revealEnrollmentSubmissionIdNumber(row)).toBe("1087654321");
  });

  it("leaves legacy plaintext unchanged when keys are unavailable", async () => {
    await prisma.enrollmentSubmission.create({
      data: {
        id: "6b3a_failed_submission",
        token_id: "6b3a_token",
        school_id: "6b3a_school",
        full_name: "Failure",
        id_number: "1076543210",
      },
    });
    const key = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      await expect(pii.backfillEnrollmentSubmissionIdNumbers(prisma, 50)).rejects.toThrow(/unavailable/);
    } finally {
      process.env.PII_ENCRYPTION_KEY = key;
    }
    await expect(prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: "6b3a_failed_submission" } }))
      .resolves.toMatchObject({
        id_number: "1076543210",
        encrypted_id_number: null,
        id_number_hash: null,
      });
  });
});
