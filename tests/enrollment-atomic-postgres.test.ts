import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
type AtomicModule = typeof import("@/lib/enrollment-atomic");
type StoredFilesModule = typeof import("@/lib/stored-files");

const schema = process.env.ENROLLMENT_6B2_SCHEMA;
const connectionString = process.env.DATABASE_URL;
const run = schema && connectionString ? describe.sequential : describe.skip;
const suffix = randomBytes(5).toString("hex");
const schoolId = `6b2_school_${suffix}`;
const otherSchoolId = `6b2_other_${suffix}`;
let prisma: PrismaClient;
let atomic: AtomicModule;
let storedFiles: StoredFilesModule;

async function createToken(id: string, maxSubmissions: number, expiresAt = new Date(Date.now() + 86_400_000)) {
  return prisma.enrollmentToken.create({
    data: {
      id,
      school_id: schoolId,
      token: `${id}_raw`,
      status: "active",
      otp_verified: true,
      max_submissions: maxSubmissions,
      expires_at: expiresAt,
    },
  });
}

async function submitOnce(tokenId: string, submissionId: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await atomic.reserveEnrollmentSlot(tx, {
      id: tokenId,
      token: `${tokenId}_raw`,
      schoolId,
      now: new Date(),
    });
    if (!reservation) return false;
    await tx.enrollmentSubmission.create({
      data: { id: submissionId, token_id: tokenId, school_id: schoolId, full_name: "Child" },
    });
    return true;
  }, { maxWait: 30_000, timeout: 30_000 });
}

async function approveOnce(submissionId: string) {
  return prisma.$transaction(async (tx) => {
    if (!(await atomic.lockEnrollmentSubmission(tx, { id: submissionId, schoolId }))) return false;
    const submission = await tx.enrollmentSubmission.findFirst({
      where: { id: submissionId, school_id: schoolId },
    });
    if (submission?.status !== "pending_review") return false;
    const student = await tx.student.create({ data: { name: "Approved", schoolId } });
    if (submission.evaluation_file_url) {
      await storedFiles.transferStoredFileOwnership(tx, {
        key: submission.evaluation_file_url.replace("/api/files/", ""),
        schoolId,
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: submissionId,
        nextOwnerType: "STUDENT",
        nextOwnerId: student.id,
      });
    }
    const updated = await tx.enrollmentSubmission.updateMany({
      where: { id: submissionId, school_id: schoolId, status: "pending_review" },
      data: { status: "approved", student_id: student.id, reviewed_at: new Date() },
    });
    if (updated.count !== 1) throw new Error("approval CAS failed");
    await tx.activityLog.create({
      data: { school_id: schoolId, action: "6B2 approval", performed_by: "test" },
    });
    return true;
  });
}

async function rejectOnce(submissionId: string) {
  return prisma.$transaction(async (tx) => {
    if (!(await atomic.lockEnrollmentSubmission(tx, { id: submissionId, schoolId }))) return false;
    const submission = await tx.enrollmentSubmission.findFirst({
      where: { id: submissionId, school_id: schoolId },
    });
    if (submission?.status !== "pending_review") return false;
    const key = submission.evaluation_file_url?.replace("/api/files/", "");
    if (key) {
      await storedFiles.markStoredFileForDeletion(tx, {
        key,
        schoolId,
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: submissionId,
      });
    }
    await tx.enrollmentSubmission.update({
      where: { id: submissionId },
      data: { status: "rejected", reviewed_at: new Date() },
    });
    await tx.activityLog.create({
      data: { school_id: schoolId, action: "6B2 rejection", performed_by: "test" },
    });
    return true;
  });
}

run("enrollment atomicity on PostgreSQL", () => {
  beforeAll(async () => {
    if (!schema || !connectionString || !schema.startsWith("codex_6b2_") || schema === "public") {
      throw new Error("Unsafe 6B2 PostgreSQL schema");
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    atomic = await import("@/lib/enrollment-atomic");
    storedFiles = await import("@/lib/stored-files");
    const current = await prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
    expect(current[0]?.schema).toBe(schema);
    await prisma.school.createMany({
      data: [
        { id: schoolId, name: "6B2 School" },
        { id: otherSchoolId, name: "6B2 Other School" },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("allows only the configured number of concurrent submissions", async () => {
    const tokenId = `6b2_limit_${suffix}`;
    await createToken(tokenId, 10);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, index) => submitOnce(tokenId, `6b2_limit_sub_${suffix}_${index}`))
    );
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await prisma.enrollmentSubmission.count({ where: { token_id: tokenId } })).toBe(10);
    await expect(prisma.enrollmentToken.findUniqueOrThrow({ where: { id: tokenId } }))
      .resolves.toMatchObject({ submissions_count: 10, status: "completed" });
  }, 60_000);

  it("allows the boundary request and rejects the one after it", async () => {
    const tokenId = `6b2_boundary_${suffix}`;
    await createToken(tokenId, 1);
    expect(await submitOnce(tokenId, `6b2_boundary_sub_${suffix}`)).toBe(true);
    expect(await submitOnce(tokenId, `6b2_boundary_loser_${suffix}`)).toBe(false);
  });

  it("rolls back the slot when submission creation or file transfer fails", async () => {
    const duplicateToken = `6b2_duplicate_${suffix}`;
    await createToken(duplicateToken, 2);
    await prisma.enrollmentSubmission.create({
      data: { id: `6b2_duplicate_sub_${suffix}`, token_id: duplicateToken, school_id: schoolId, full_name: "Existing" },
    });
    await expect(submitOnce(duplicateToken, `6b2_duplicate_sub_${suffix}`)).rejects.toBeTruthy();
    expect((await prisma.enrollmentToken.findUniqueOrThrow({ where: { id: duplicateToken } })).submissions_count).toBe(0);

    const fileToken = `6b2_file_rollback_${suffix}`;
    await createToken(fileToken, 2);
    const key = `schools/${schoolId}/students/${fileToken}/evaluation.pdf`;
    await prisma.storedFile.create({
      data: {
        key,
        schoolId,
        category: "students",
        ownerType: "ENROLLMENT_TOKEN",
        ownerId: fileToken,
        contentType: "application/pdf",
        sizeBytes: 1,
      },
    });
    await expect(prisma.$transaction(async (tx) => {
      const reserved = await atomic.reserveEnrollmentSlot(tx, {
        id: fileToken,
        token: `${fileToken}_raw`,
        schoolId,
        now: new Date(),
      });
      expect(reserved).not.toBeNull();
      const submission = await tx.enrollmentSubmission.create({
        data: { token_id: fileToken, school_id: schoolId, full_name: "Rollback" },
      });
      await storedFiles.transferStoredFileOwnership(tx, {
        key,
        schoolId: otherSchoolId,
        ownerType: "ENROLLMENT_TOKEN",
        ownerId: fileToken,
        nextOwnerType: "ENROLLMENT_SUBMISSION",
        nextOwnerId: submission.id,
      });
    })).rejects.toBeTruthy();
    expect((await prisma.enrollmentToken.findUniqueOrThrow({ where: { id: fileToken } })).submissions_count).toBe(0);
    expect(await prisma.enrollmentSubmission.count({ where: { token_id: fileToken } })).toBe(0);
    await expect(prisma.storedFile.findUniqueOrThrow({ where: { key } })).resolves.toMatchObject({
      ownerType: "ENROLLMENT_TOKEN",
      ownerId: fileToken,
    });
  });

  it("lets only one concurrent approval create a student and transfer the file", async () => {
    const tokenId = `6b2_approve_${suffix}`;
    const submissionId = `6b2_approve_sub_${suffix}`;
    await createToken(tokenId, 2);
    const key = `schools/${schoolId}/students/${submissionId}/evaluation.pdf`;
    await prisma.enrollmentSubmission.create({
      data: {
        id: submissionId,
        token_id: tokenId,
        school_id: schoolId,
        full_name: "Approve",
        evaluation_file_url: `/api/files/${key}`,
      },
    });
    await prisma.storedFile.create({
      data: {
        key,
        schoolId,
        category: "students",
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: submissionId,
        contentType: "application/pdf",
        sizeBytes: 1,
      },
    });
    const outcomes = await Promise.all([approveOnce(submissionId), approveOnce(submissionId)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const submission = await prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(submission.status).toBe("approved");
    expect(await prisma.student.count({ where: { id: submission.student_id ?? "" } })).toBe(1);
    await expect(prisma.storedFile.findUniqueOrThrow({ where: { key } })).resolves.toMatchObject({
      ownerType: "STUDENT",
      ownerId: submission.student_id,
    });
  });

  it("has one winner between approval and rejection", async () => {
    const tokenId = `6b2_review_race_${suffix}`;
    const submissionId = `6b2_review_race_sub_${suffix}`;
    await createToken(tokenId, 2);
    await prisma.enrollmentSubmission.create({
      data: { id: submissionId, token_id: tokenId, school_id: schoolId, full_name: "Race" },
    });
    const outcomes = await Promise.all([approveOnce(submissionId), rejectOnce(submissionId)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const submission = await prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(["approved", "rejected"]).toContain(submission.status);
    expect(await prisma.student.count({ where: { id: submission.student_id ?? "" } })).toBe(
      submission.status === "approved" ? 1 : 0
    );
  });

  it("rolls back student, status, and ownership when the audit write fails", async () => {
    const tokenId = `6b2_audit_${suffix}`;
    const submissionId = `6b2_audit_sub_${suffix}`;
    await createToken(tokenId, 2);
    await prisma.enrollmentSubmission.create({
      data: { id: submissionId, token_id: tokenId, school_id: schoolId, full_name: "Audit rollback" },
    });
    await expect(prisma.$transaction(async (tx) => {
      expect(await atomic.lockEnrollmentSubmission(tx, { id: submissionId, schoolId })).toBe(true);
      const student = await tx.student.create({ data: { name: "Rolled back", schoolId } });
      await tx.enrollmentSubmission.update({
        where: { id: submissionId },
        data: { status: "approved", student_id: student.id },
      });
      await tx.activityLog.create({
        data: { school_id: "missing-school", action: "must fail", performed_by: "test" },
      });
    })).rejects.toBeTruthy();
    await expect(prisma.enrollmentSubmission.findUniqueOrThrow({ where: { id: submissionId } }))
      .resolves.toMatchObject({ status: "pending_review", student_id: null });
    expect(await prisma.student.count({ where: { name: "Rolled back", schoolId } })).toBe(0);
  });

  it("marks a rejected file for retry and isolates cross-tenant review", async () => {
    const tokenId = `6b2_reject_${suffix}`;
    const submissionId = `6b2_reject_sub_${suffix}`;
    await createToken(tokenId, 2);
    const key = `schools/${schoolId}/students/${submissionId}/reject.pdf`;
    await prisma.enrollmentSubmission.create({
      data: {
        id: submissionId,
        token_id: tokenId,
        school_id: schoolId,
        full_name: "Reject",
        evaluation_file_url: `/api/files/${key}`,
      },
    });
    await prisma.storedFile.create({
      data: {
        key,
        schoolId,
        category: "students",
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: submissionId,
        contentType: "application/pdf",
        sizeBytes: 1,
      },
    });
    expect(await rejectOnce(submissionId)).toBe(true);
    expect(await rejectOnce(submissionId)).toBe(false);
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { key } })).deletePendingAt).toBeInstanceOf(Date);
    await prisma.$transaction(async (tx) => {
      expect(await atomic.lockEnrollmentSubmission(tx, { id: submissionId, schoolId: otherSchoolId })).toBe(false);
    });
  });

  it("retains tokens with submissions while purging unrelated old tokens", async () => {
    const old = new Date(Date.now() - 10 * 86_400_000);
    const retained = `6b2_retained_${suffix}`;
    const purged = `6b2_purged_${suffix}`;
    await createToken(retained, 2, old);
    await createToken(purged, 2, old);
    await prisma.enrollmentSubmission.create({
      data: { token_id: retained, school_id: schoolId, full_name: "History" },
    });
    const result = await storedFiles.purgeExpiredEnrollmentTokens({ now: new Date(), limit: 100, db: prisma });
    expect(result.retainedWithSubmissions).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    await expect(prisma.enrollmentToken.findUniqueOrThrow({ where: { id: retained } }))
      .resolves.toMatchObject({ status: "expired" });
    expect(await prisma.enrollmentToken.findUnique({ where: { id: purged } })).toBeNull();
  });
});
