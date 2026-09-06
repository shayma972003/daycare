import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildActivityRequestPayload, type ActivityFormRequestInput } from "@/lib/activity-timing";

const mocks = vi.hoisted(() => ({
  activityCreate: vi.fn(),
  activityFindFirst: vi.fn(),
  activityUpdate: vi.fn(),
  inviteDeleteMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  logAction: vi.fn(),
  assertTeacherOwned: vi.fn(),
  assertClassOwned: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
    can: (permission: string) => permission === "schedule.manage",
  })),
  sessionErrorResponse: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: {
      create: mocks.activityCreate,
      findFirst: mocks.activityFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/academic-stage", () => ({
  resolveStageId: vi.fn(async (id: string | null | undefined) => id || null),
  foreignStageResponse: vi.fn(),
}));
vi.mock("@/lib/tenant-guard", () => ({
  assertTeacherOwned: mocks.assertTeacherOwned,
  assertClassOwned: mocks.assertClassOwned,
  crossTenantResponse: vi.fn(),
}));

import { POST } from "@/app/api/activities/route";
import { PUT } from "@/app/api/activities/[id]/route";

const baseForm: ActivityFormRequestInput = {
  name: "Reading circle",
  teacherId: "teacher-1",
  childrenCount: 8,
  stageId: "stage-1",
  period: "MORNING",
  startDate: "2026-09-03",
  endDate: "2026-09-03",
  startTime: "09:15",
  endTime: "10:30",
  allDay: false,
  fee: 0,
  message: "Bring a book",
  classIds: ["class-1"],
};

function jsonRequest(path: string, method: "POST" | "PUT", body: object) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertTeacherOwned.mockImplementation(async (id: string | null) => id);
  mocks.assertClassOwned.mockImplementation(async (id: string) => id);
  mocks.activityCreate.mockResolvedValue({ id: "activity-created", name: "Reading circle" });
  mocks.activityFindFirst.mockResolvedValue({
    id: "activity-1",
    schoolId: "school-1",
    startDate: new Date("2026-09-03T00:00:00.000Z"),
    endDate: new Date("2026-09-03T00:00:00.000Z"),
    allDay: true,
    updatedAt: new Date("2026-09-03T08:00:00.000Z"),
  });
  mocks.activityUpdate.mockResolvedValue({ id: "activity-1", name: "Reading circle" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.queryRaw,
    activityInvite: { deleteMany: mocks.inviteDeleteMany },
    activity: { findFirst: mocks.activityFindFirst, update: mocks.activityUpdate },
  }));
  mocks.queryRaw.mockResolvedValue([{ id: "activity-1" }]);
});

describe("activity editor payload against strict API routes", () => {
  for (const allDay of [false, true]) {
    it(`creates a ${allDay ? "all-day" : "timed"} activity with only API contract fields`, async () => {
      const form = {
        ...baseForm,
        allDay,
        ...(allDay ? { startDate: "2026-09-03", endDate: "2026-09-04" } : {}),
      };
      const payload = buildActivityRequestPayload(form, null, "Asia/Tokyo");
      expect(payload).not.toBeNull();
      expect(payload).not.toHaveProperty("startTime");
      expect(payload).not.toHaveProperty("endTime");

      const response = await POST(jsonRequest("/api/activities", "POST", payload!));
      expect(response.status).toBe(201);
      expect(mocks.activityCreate).toHaveBeenCalledTimes(1);
      expect(mocks.activityCreate.mock.calls[0][0].data.allDay).toBe(allDay);
    });

    it(`updates a ${allDay ? "all-day" : "timed"} activity with only API contract fields`, async () => {
      const form = {
        ...baseForm,
        allDay,
        ...(allDay ? { startDate: "2026-09-03", endDate: "2026-09-04" } : {}),
      };
      const payload = buildActivityRequestPayload(form, "/activity.png", "America/New_York");
      const response = await PUT(
        jsonRequest("/api/activities/activity-1", "PUT", payload!),
        { params: Promise.resolve({ id: "activity-1" }) }
      );
      expect(response.status).toBe(200);
      expect(mocks.activityUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.activityUpdate.mock.calls[0][0].data.allDay).toBe(allDay);
    });
  }

  it("keeps the route strict and returns a human-readable validation error", async () => {
    const payload = buildActivityRequestPayload(baseForm, null, "UTC")!;
    const response = await POST(jsonRequest("/api/activities", "POST", {
      ...payload,
      startTime: "09:15",
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(typeof body.error).toBe("string");
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
