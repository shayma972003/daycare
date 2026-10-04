import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  reportFindMany: vi.fn(),
  reportUpdateMany: vi.fn(),
  reportCreate: vi.fn(),
  studentFindMany: vi.fn(),
  returnedFindMany: vi.fn(),
  settingsFindUnique: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    careReport: { findMany: mocks.returnedFindMany },
    settings: { findUnique: mocks.settingsFindUnique },
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: mocks.notify }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { POST } from "@/app/api/care-reports/returned/[batchId]/resubmit/route";
import { GET } from "@/app/api/care-reports/returned/route";

const tx = {
  $queryRaw: mocks.queryRaw,
  careReport: {
    findMany: mocks.reportFindMany,
    updateMany: mocks.reportUpdateMany,
    create: mocks.reportCreate,
  },
  student: { findMany: mocks.studentFindMany },
};

function request() {
  return new Request("http://localhost/api/care-reports/returned/returned-batch-123456/resubmit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "returned-batch-123456",
      meal: { source: "CENTER", name: "Rice", occurredAt: "2026-09-18T09:00:00.000Z" },
      entries: [{
        studentId: "student-1",
        mealAmount: "ALL",
        napStatus: "NO_RECORD",
        napStartAt: null,
        napEndAt: null,
        toilet: "NO_RECORD",
        toiletOccurredAt: null,
        mood: null,
        note: null,
        extraEvents: [],
        supplies: null,
        health: null,
        medication: null,
      }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsFindUnique.mockResolvedValue(null);
  mocks.notify.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue({
    user: { id: "teacher-user", schoolId: "school-1", name: "Teacher A" },
    teacherId: "teacher-1",
    teacherClassIds: ["class-1"],
    permissions: ["attendance.students"],
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.queryRaw.mockResolvedValue([{ id: "report-meal" }]);
  mocks.reportFindMany.mockResolvedValue([
    {
      id: "report-meal",
      schoolId: "school-1",
      studentId: "student-1",
      classId: "class-1",
      teacherId: "teacher-1",
      dailyBatchId: "returned-batch-123456",
      dailyBatchHash: "old-hash",
      dailyItemKey: "meal",
      reviewStatus: "REJECTED",
      deletedAt: null,
    },
    {
      id: "report-old-mood",
      schoolId: "school-1",
      studentId: "student-1",
      classId: "class-1",
      teacherId: "teacher-1",
      dailyBatchId: "returned-batch-123456",
      dailyBatchHash: "old-hash",
      dailyItemKey: "mood",
      reviewStatus: "REJECTED",
      deletedAt: null,
    },
  ]);
  mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
  mocks.reportUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reportCreate.mockResolvedValue({ id: "new-report" });
  mocks.log.mockResolvedValue(undefined);
});

describe("returned daily care resubmission", () => {
  it("resubmits the original student set atomically and removes stale items", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      created: 1,
      replayed: false,
      status: "PENDING_REVIEW",
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "report-meal" }),
      data: expect.objectContaining({
        reviewStatus: "PENDING_REVIEW",
        reviewNote: null,
        deletedAt: null,
        mealName: "Rice",
      }),
    }));
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["report-old-mood"] } }),
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }));
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });

  it("sends a corrected report directly when review is disabled", async () => {
    mocks.settingsFindUnique.mockResolvedValue({ careReportReviewRequired: false });

    const response = await POST(request(), {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      replayed: false,
      status: "APPROVED",
    });
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "report-meal" }),
      data: expect.objectContaining({
        reviewStatus: "APPROVED",
        reviewedAt: expect.any(Date),
      }),
    }));
    expect(mocks.notify).toHaveBeenCalledWith("school-1", ["report-meal"]);
  });

  it("does not allow an office account to use the teacher correction route", async () => {
    mocks.session.mockResolvedValue({
      user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
      teacherId: null,
      teacherClassIds: null,
      permissions: ["*"],
    });

    const response = await POST(request(), {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects changing the children in the original returned batch", async () => {
    const altered = new Request("http://localhost/api/care-reports/returned/returned-batch-123456/resubmit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "returned-batch-123456",
        meal: { source: "CENTER", name: "Rice", occurredAt: "2026-09-18T09:00:00.000Z" },
        entries: [{
          studentId: "different-student",
          mealAmount: "ALL",
          napStatus: "NO_RECORD",
          toilet: "NO_RECORD",
          extraEvents: [],
        }],
      }),
    });

    const response = await POST(altered, {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "STUDENT_SET_CHANGED" });
    expect(mocks.studentFindMany).not.toHaveBeenCalled();
  });
});

describe("returned daily care list", () => {
  it("returns no teacher correction queue to an unscoped office account", async () => {
    mocks.session.mockResolvedValue({
      user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
      teacherId: null,
      teacherClassIds: null,
      permissions: ["*"],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(mocks.returnedFindMany).not.toHaveBeenCalled();
  });

  it("scopes returned batches to the signed-in teacher and assigned classes", async () => {
    mocks.returnedFindMany
      .mockResolvedValueOnce([{ dailyBatchId: "returned-batch-123456" }])
      .mockResolvedValueOnce([]);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.returnedFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        teacherId: "teacher-1",
        reviewStatus: "REJECTED",
        student: { classId: { in: ["class-1"] } },
      }),
    }));
    expect(mocks.returnedFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        teacherId: "teacher-1",
        dailyBatchId: { in: ["returned-batch-123456"] },
      }),
    }));
  });
});
