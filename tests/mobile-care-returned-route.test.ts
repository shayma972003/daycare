import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  reportFindMany: vi.fn(),
  reportUpdateMany: vi.fn(),
  reportCreate: vi.fn(),
  studentFindMany: vi.fn(),
  returnedFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  settingsFindUnique: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.guard,
  mobileAuthResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    careReport: { findMany: mocks.returnedFindMany },
    user: { findFirst: mocks.userFindFirst },
    settings: { findUnique: mocks.settingsFindUnique },
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: mocks.notify }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { GET } from "@/app/api/mobile/v1/care-reports/returned/route";
import { POST } from "@/app/api/mobile/v1/care-reports/returned/[batchId]/resubmit/route";

const tx = {
  $queryRaw: mocks.queryRaw,
  careReport: {
    findMany: mocks.reportFindMany,
    updateMany: mocks.reportUpdateMany,
    create: mocks.reportCreate,
  },
  student: { findMany: mocks.studentFindMany },
};

function context(teacherId: string | null = "teacher-1") {
  return {
    claims: { sub: "teacher-user", schoolId: "school-1", kind: "staff" },
    schoolId: "school-1",
    teacherId,
    teacherClassIds: ["class-1"],
    permissions: ["attendance.students"],
    can: () => true,
  };
}

function resubmitRequest() {
  return new Request("http://localhost/api/mobile/v1/care-reports/returned/returned-batch-123456/resubmit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "returned-batch-123456",
      meal: { source: "CENTER", name: null, occurredAt: "2026-09-18T09:00:00.000Z" },
      entries: [{
        studentId: "student-1",
        mealAmount: null,
        napStatus: "SLEPT",
        napStartAt: "2026-09-18T10:00:00.000Z",
        napEndAt: null,
        toilet: "NO_RECORD",
        toiletOccurredAt: null,
        mood: null,
        note: null,
        extraEvents: [],
        supplies: null,
        health: null,
        medication: { name: "دواء", dose: "", occurredAt: null },
      }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(context());
  mocks.settingsFindUnique.mockResolvedValue(null);
  mocks.notify.mockResolvedValue(undefined);
  mocks.userFindFirst.mockResolvedValue({ name: "Teacher A" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.queryRaw.mockResolvedValue([{ id: "report-meal" }]);
  mocks.reportFindMany.mockResolvedValue([{
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
  }]);
  mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
  mocks.reportUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reportCreate.mockResolvedValue({ id: "new-report" });
  mocks.log.mockResolvedValue(undefined);
});

describe("mobile returned care reports", () => {
  it("lists only the signed-in teacher's returned class-scoped batches", async () => {
    mocks.returnedFindMany
      .mockResolvedValueOnce([{ dailyBatchId: "returned-batch-123456" }])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost/api/mobile/v1/care-reports/returned"));
    expect(response.status).toBe(200);
    expect(mocks.returnedFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        teacherId: "teacher-1",
        reviewStatus: "REJECTED",
        student: { classId: { in: ["class-1"] } },
      }),
    }));
  });

  it("returns an empty correction queue to a staff account with no teacher profile", async () => {
    mocks.guard.mockResolvedValue(context(null));
    const response = await GET(new Request("http://localhost/api/mobile/v1/care-reports/returned"));
    await expect(response.json()).resolves.toEqual([]);
    expect(mocks.returnedFindMany).not.toHaveBeenCalled();
  });

  it("resubmits optional-time and partial-medication corrections for review", async () => {
    const response = await POST(resubmitRequest(), {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replayed: false,
      status: "PENDING_REVIEW",
    });
    expect(mocks.reportCreate.mock.calls.map(([argument]) => argument.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reviewStatus: "PENDING_REVIEW",
          type: "NAP",
          napStartAt: expect.any(Date),
          napEndAt: null,
        }),
        expect.objectContaining({
          reviewStatus: "PENDING_REVIEW",
          type: "MEDICATION",
          medicationName: "دواء",
          medicationDose: null,
        }),
      ])
    );
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });

  it("approves and notifies corrected reports in direct-delivery mode", async () => {
    mocks.settingsFindUnique.mockResolvedValue({ careReportReviewRequired: false });

    const response = await POST(resubmitRequest(), {
      params: Promise.resolve({ batchId: "returned-batch-123456" }),
    });

    await expect(response.json()).resolves.toMatchObject({ status: "APPROVED" });
    expect(mocks.reportCreate.mock.calls.map(([argument]) => argument.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reviewStatus: "APPROVED" }),
      ])
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      "school-1",
      expect.arrayContaining(["report-meal", "new-report"])
    );
  });
});
