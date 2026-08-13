import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionErrorResponse: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  markForDeletion: vi.fn(),
  completeDeletion: vi.fn(),
  transferOwnership: vi.fn(),
  studentCreate: vi.fn(),
  queryRaw: vi.fn(),
  activityCreate: vi.fn(),
  guardianFindFirst: vi.fn(),
  guardianUpdateMany: vi.fn(),
  guardianCreate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    enrollmentSubmission: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    student: { create: mocks.studentCreate },
  },
}));

vi.mock("@/lib/r2", () => ({
  keyFromUrl: (url: string | null) => url?.startsWith("/api/files/")
    ? url.slice("/api/files/".length)
    : null,
}));

vi.mock("@/lib/stored-files", () => {
  class StoredFileOwnershipError extends Error {}
  return {
    StoredFileOwnershipError,
    markStoredFileForDeletion: mocks.markForDeletion,
    completeStoredFileDeletion: mocks.completeDeletion,
    transferStoredFileOwnership: mocks.transferOwnership,
  };
});

vi.mock("@/lib/pii-crypto", () => ({
  protectIdNumber: () => ({ idNumber: null, encryptedIdNumber: null, idNumberHash: null }),
}));
vi.mock("@/lib/tenant-guard", () => ({
  assertClassOwned: vi.fn().mockResolvedValue(null),
  crossTenantResponse: () => null,
}));
vi.mock("@/lib/academic-stage", () => ({
  resolveStageId: vi.fn().mockResolvedValue(null),
  foreignStageResponse: () => null,
}));
vi.mock("@/lib/enum-labels", () => ({
  parseAcademicStage: () => null,
  parseAttendanceType: () => "REGULAR",
}));

vi.mock("@/lib/activity-logger", () => ({
  activityLogData: (data: unknown) => data,
}));

import { GET as listSubmissions } from "@/app/api/enrollment/submissions/route";
import { POST as rejectSubmission } from "@/app/api/enrollment/reject/[submission_id]/route";
import { POST as approveSubmission } from "@/app/api/enrollment/approve/[submission_id]/route";

function session(allowed: boolean) {
  return {
    user: { id: "user-1", schoolId: "school-1", name: "Manager" },
    can: vi.fn((permission: string) => allowed && permission === "students.manage"),
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sessionErrorResponse.mockImplementation(() =>
    Response.json({ error: "Unauthorized" }, { status: 401 })
  );
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      $queryRaw: mocks.queryRaw,
      enrollmentSubmission: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
      student: { create: mocks.studentCreate },
      guardian: {
        findFirst: mocks.guardianFindFirst,
        updateMany: mocks.guardianUpdateMany,
        create: mocks.guardianCreate,
      },
      activityLog: { create: mocks.activityCreate },
      storedFile: { updateMany: vi.fn() },
    })
  );
  mocks.queryRaw.mockResolvedValue([{ id: "submission-1" }]);
  mocks.activityCreate.mockResolvedValue({});
  mocks.markForDeletion.mockResolvedValue("pending");
  mocks.completeDeletion.mockResolvedValue({ status: "deleted" });
  mocks.transferOwnership.mockResolvedValue(undefined);
});

describe("administrative enrollment handlers", () => {
  it("returns 401 before querying data when the caller is not signed in", async () => {
    mocks.requireSession.mockRejectedValue(new Error("no session"));

    const response = await listSubmissions();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns 403 before querying data when students.manage is missing", async () => {
    mocks.requireSession.mockResolvedValue(session(false));

    const response = await listSubmissions();

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the permitted manager's school submissions", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findMany.mockResolvedValue([{ id: "submission-1" }]);

    const response = await listSubmissions();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { school_id: "school-1", status: "pending_review" },
      orderBy: { submitted_at: "desc" },
    });
  });

  it("does not reveal or update a submission owned by another school", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue(null);

    const response = await rejectSubmission(
      new Request("http://localhost/api/enrollment/reject/foreign", { method: "POST" }),
      { params: Promise.resolve({ submission_id: "foreign" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", school_id: "school-1" },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("keeps a rejected file retryable when object storage deletion fails", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue({
      id: "submission-1",
      school_id: "school-1",
      status: "pending_review",
      full_name: "Child",
      evaluation_file_url: "/api/files/schools/school-1/students/submission-1/file.pdf",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.completeDeletion.mockResolvedValue({ status: "pending" });

    const response = await rejectSubmission(
      new Request("http://localhost/api/enrollment/reject/submission-1", { method: "POST" }),
      { params: Promise.resolve({ submission_id: "submission-1" }) }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ cleanup_pending: true });
    expect(mocks.markForDeletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        schoolId: "school-1",
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: "submission-1",
      })
    );
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
  });

  it("deletes a rejected submission file before reporting success", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue({
      id: "submission-1",
      school_id: "school-1",
      status: "pending_review",
      full_name: "Child",
      evaluation_file_url: "/api/files/schools/school-1/students/submission-1/file.pdf",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const response = await rejectSubmission(
      new Request("http://localhost/api/enrollment/reject/submission-1", { method: "POST" }),
      { params: Promise.resolve({ submission_id: "submission-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.completeDeletion).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: "submission-1", school_id: "school-1", status: "rejected" },
      data: { evaluation_file_url: null, evaluation_file_name: null },
    });
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
  });

  it("moves an approved submission file to the newly created student", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue({
      id: "submission-1",
      school_id: "school-1",
      status: "pending_review",
      full_name: "Child",
      guardian_phone_1: null,
      date_of_birth: null,
      evaluation_file_url: "/api/files/schools/school-1/students/submission-1/file.pdf",
      evaluation_file_name: "file.pdf",
    });
    mocks.studentCreate.mockResolvedValue({ id: "student-1", name: "Child" });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const response = await approveSubmission(
      new Request("http://localhost/api/enrollment/approve/submission-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ submission_id: "submission-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.transferOwnership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerType: "ENROLLMENT_SUBMISSION",
        ownerId: "submission-1",
        nextOwnerType: "STUDENT",
        nextOwnerId: "student-1",
      })
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending_review", school_id: "school-1" }),
      data: expect.objectContaining({ status: "approved", student_id: "student-1" }),
    }));
  });

  it("does not mark an approval complete when ownership transfer fails", async () => {
    const { StoredFileOwnershipError } = await import("@/lib/stored-files");
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue({
      id: "submission-1",
      school_id: "school-1",
      status: "pending_review",
      full_name: "Child",
      guardian_phone_1: null,
      date_of_birth: null,
      evaluation_file_url: "/api/files/schools/school-1/students/submission-1/file.pdf",
    });
    mocks.studentCreate.mockResolvedValue({ id: "student-1", name: "Child" });
    mocks.transferOwnership.mockRejectedValue(new StoredFileOwnershipError());

    const response = await approveSubmission(
      new Request("http://localhost/api/enrollment/approve/submission-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ submission_id: "submission-1" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
