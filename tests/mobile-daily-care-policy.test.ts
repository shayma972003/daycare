import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  settingsFindUnique: vi.fn(),
  batchFindMany: vi.fn(),
  studentFindMany: vi.fn(),
  dailyFindMany: vi.fn(),
  queryRaw: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.guard,
  mobileAuthResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    settings: { findUnique: mocks.settingsFindUnique },
    careReport: { findMany: mocks.batchFindMany },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: mocks.notify }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { POST } from "@/app/api/mobile/v1/care-reports/daily/route";

const payload = {
  idempotencyKey: "mobile-care-batch-123456",
  meal: {
    source: "CENTER",
    name: "أرز",
    occurredAt: "2026-10-02T09:00:00.000Z",
  },
  entries: [{
    studentId: "student-1",
    mealAmount: "ALL",
    napStatus: "NO_RECORD",
    napStartAt: null,
    napEndAt: null,
    toilet: "NO_RECORD",
    toiletOccurredAt: null,
    mood: "HAPPY",
    note: null,
    extraEvents: [],
    supplies: null,
    health: null,
    medication: null,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    claims: { sub: "teacher-user", schoolId: "school-1", kind: "staff" },
    schoolId: "school-1",
    teacherId: "teacher-1",
    teacherClassIds: ["class-1"],
    permissions: ["attendance.students"],
    can: () => true,
  });
  mocks.settingsFindUnique.mockResolvedValue({ careReportReviewRequired: false });
  mocks.batchFindMany.mockResolvedValue([]);
  mocks.userFindFirst.mockResolvedValue({ name: "Teacher A" });
  mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
  mocks.dailyFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([]);
  let id = 0;
  mocks.create.mockImplementation(async ({ data }: { data: { studentId: string } }) => ({
    id: `mobile-report-${++id}`,
    studentId: data.studentId,
  }));
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.queryRaw,
    student: { findMany: mocks.studentFindMany },
    careReport: { create: mocks.create, findMany: mocks.dailyFindMany },
  }));
  mocks.notify.mockResolvedValue(undefined);
  mocks.log.mockResolvedValue(undefined);
});

describe("mobile daily care delivery policy", () => {
  it("approves and notifies a new mobile batch when direct delivery is enabled", async () => {
    const response = await POST(new Request("http://localhost/api/mobile/v1/care-reports/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ status: "APPROVED" });
    expect(mocks.create.mock.calls.map(([argument]) => argument.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reviewStatus: "APPROVED", reviewedAt: expect.any(Date) }),
      ])
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      "school-1",
      expect.arrayContaining(["mobile-report-1"])
    );
  });
});
