import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  expiredTokens: vi.fn(),
  rejectedSubmissions: vi.fn(),
  deleteObjects: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    storedFile: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      deleteMany: mocks.deleteMany,
    },
    enrollmentToken: { findMany: mocks.expiredTokens },
    enrollmentSubmission: { findMany: mocks.rejectedSubmissions },
  },
}));
vi.mock("@/lib/r2", () => ({
  deleteObjects: mocks.deleteObjects,
  keyFromUrl: (url: string | null) => url?.startsWith("/api/files/")
    ? url.slice("/api/files/".length)
    : null,
}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import {
  cleanupEnrollmentStoredFiles,
  discardFilesOwnedBy,
  discardStoredFile,
  StoredFileOwnershipError,
  transferStoredFileOwnership,
} from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("StoredFile ownership lifecycle", () => {
  it("moves token to submission to student only through exact conditional updates", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const db = { storedFile: { updateMany: mocks.updateMany } } as never;

    await transferStoredFileOwnership(db, {
      key: "schools/school-1/students/token-1/file.pdf",
      schoolId: "school-1",
      ownerType: STORED_FILE_OWNER.ENROLLMENT_TOKEN,
      ownerId: "token-1",
      nextOwnerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
      nextOwnerId: "submission-1",
    });
    await transferStoredFileOwnership(db, {
      key: "schools/school-1/students/token-1/file.pdf",
      schoolId: "school-1",
      ownerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
      ownerId: "submission-1",
      nextOwnerType: STORED_FILE_OWNER.STUDENT,
      nextOwnerId: "student-1",
    });

    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        schoolId: "school-1",
        ownerType: "ENROLLMENT_TOKEN",
        ownerId: "token-1",
        deletePendingAt: null,
      }),
      data: { ownerType: "ENROLLMENT_SUBMISSION", ownerId: "submission-1" },
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: "submission-1",
      }),
      data: { ownerType: "STUDENT", ownerId: "student-1" },
    });
  });

  it("rejects a key whose current owner does not match", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const db = { storedFile: { updateMany: mocks.updateMany } } as never;

    await expect(transferStoredFileOwnership(db, {
      key: "schools/school-1/students/other/file.pdf",
      schoolId: "school-1",
      ownerType: STORED_FILE_OWNER.ENROLLMENT_TOKEN,
      ownerId: "token-1",
      nextOwnerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
      nextOwnerId: "submission-1",
    })).rejects.toBeInstanceOf(StoredFileOwnershipError);
  });

  it("retains the database row and retry marker when R2 deletion fails", async () => {
    mocks.findUnique.mockResolvedValue({
      key: "schools/school-1/students/student-1/file.pdf",
      schoolId: "school-1",
      ownerType: "STUDENT",
      ownerId: "student-1",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({
      key: "schools/school-1/students/student-1/file.pdf",
    });
    mocks.deleteObjects.mockResolvedValue(0);

    await expect(discardStoredFile(
      "/api/files/schools/school-1/students/student-1/file.pdf"
    )).resolves.toEqual({ status: "pending" });

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { deletePendingAt: expect.any(Date) },
    }));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it("deletes anonymized child files by tenant and explicit STUDENT type", async () => {
    mocks.findMany.mockResolvedValue([{
      key: "schools/school-1/students/student-1/file.pdf",
      ownerId: "student-1",
    }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({
      key: "schools/school-1/students/student-1/file.pdf",
    });
    mocks.deleteObjects.mockResolvedValue(1);
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await expect(discardFilesOwnedBy(
      "school-1",
      ["student-1"],
      STORED_FILE_OWNER.STUDENT,
      "anonymization.student"
    )).resolves.toEqual({ expected: 1, deleted: 1 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        schoolId: "school-1",
        ownerType: "STUDENT",
        ownerId: { in: ["student-1"] },
      },
      select: { key: true, ownerId: true },
    });
    expect(mocks.deleteObjects).toHaveBeenCalledWith([
      "schools/school-1/students/student-1/file.pdf",
    ]);
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("selects only expired token files, rejected submission files, or pending retries", async () => {
    mocks.expiredTokens.mockResolvedValue([{ id: "expired-token", school_id: "school-1" }]);
    mocks.rejectedSubmissions.mockResolvedValue([
      { id: "rejected-submission", school_id: "school-1" },
    ]);
    mocks.findMany.mockResolvedValue([]);

    await cleanupEnrollmentStoredFiles({ now: new Date("2026-08-11T00:00:00Z"), limit: 25 });

    expect(mocks.rejectedSubmissions).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "rejected", evaluation_file_url: { not: null } },
      take: 25,
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.arrayContaining([
        expect.objectContaining({
          schoolId: "school-1",
          ownerType: "ENROLLMENT_TOKEN",
          ownerId: "expired-token",
        }),
        expect.objectContaining({
          schoolId: "school-1",
          ownerType: "ENROLLMENT_SUBMISSION",
          ownerId: "rejected-submission",
        }),
      ]) },
      take: 25,
    }));
    expect(mocks.deleteObjects).not.toHaveBeenCalled();
  });

  it("removes an expired token orphan but never selects a live submission", async () => {
    mocks.expiredTokens.mockResolvedValue([{ id: "expired-token", school_id: "school-1" }]);
    mocks.rejectedSubmissions.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([{
      key: "schools/school-1/students/expired-token/orphan.pdf",
      schoolId: "school-1",
      ownerType: "ENROLLMENT_TOKEN",
      ownerId: "expired-token",
    }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({
      key: "schools/school-1/students/expired-token/orphan.pdf",
    });
    mocks.deleteObjects.mockResolvedValue(1);
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await expect(cleanupEnrollmentStoredFiles({ limit: 10 })).resolves.toEqual({
      inspected: 1,
      deleted: 1,
      pending: 0,
    });
    const candidateQuery = mocks.findMany.mock.calls[0]?.[0];
    expect(JSON.stringify(candidateQuery)).not.toContain("pending_review");
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });
});
