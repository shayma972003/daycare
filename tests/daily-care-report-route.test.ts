import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batchFindMany: vi.fn(),
  studentFindMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    user: { schoolId: "school-1", name: "Teacher One" },
    teacherId: "teacher-1",
  })),
  sessionErrorResponse: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    careReport: { findMany: mocks.batchFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: mocks.notify }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { POST } from "@/app/api/care-reports/daily/route";

const basePayload = {
  idempotencyKey: "care-batch-1234567890",
  meal: {
    source: "CENTER",
    name: "أرز وخضار",
    occurredAt: "2026-09-08T09:00:00.000Z",
  },
  entries: [
    {
      studentId: "student-1",
      mealAmount: "ALL",
      napStatus: "SLEPT",
      napStartAt: "2026-09-08T10:00:00.000Z",
      napEndAt: "2026-09-08T11:30:00.000Z",
      toilet: "DIAPER_WET",
      mood: "HAPPY",
      note: "يوم جميل",
    },
    {
      studentId: "student-2",
      mealAmount: "HALF",
      napStatus: "DID_NOT_SLEEP",
      napStartAt: null,
      napEndAt: null,
      toilet: "POTTY",
      mood: "CALM",
      note: null,
    },
  ],
};

function request(payload: unknown) {
  return new Request("http://localhost/api/care-reports/daily", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batchFindMany.mockResolvedValue([]);
  mocks.studentFindMany.mockResolvedValue([
    { id: "student-1", classId: "class-1" },
    { id: "student-2", classId: "class-1" },
  ]);
  let id = 0;
  mocks.create.mockImplementation(async ({ data }: { data: { studentId: string } }) => ({
    id: `report-${++id}`,
    studentId: data.studentId,
  }));
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    student: { findMany: mocks.studentFindMany },
    careReport: { create: mocks.create },
  }));
  mocks.notify.mockResolvedValue(undefined);
  mocks.log.mockResolvedValue(undefined);
});

describe("unified daily care report route", () => {
  it("stores shared centre meal data and each child's own care values atomically", async () => {
    const response = await POST(request(basePayload));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.created).toBe(9);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    const writes = mocks.create.mock.calls.map(([argument]) => argument.data);
    expect(writes.filter((row) => row.type === "MEAL")).toEqual([
      expect.objectContaining({ studentId: "student-1", mealSource: "CENTER", mealName: "أرز وخضار", mealAmount: "ALL" }),
      expect.objectContaining({ studentId: "student-2", mealSource: "CENTER", mealName: "أرز وخضار", mealAmount: "HALF" }),
    ]);
    expect(writes).toContainEqual(expect.objectContaining({
      studentId: "student-1",
      type: "NAP",
      napMinutes: 90,
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      studentId: "student-2",
      type: "NAP",
      napQuality: "DID_NOT_SLEEP",
    }));
    expect(mocks.notify).toHaveBeenCalledWith("school-1", expect.arrayContaining(["report-1", "report-9"]));
  });

  it("does not request a name for a home meal", async () => {
    mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
    const payload = {
      ...basePayload,
      meal: { ...basePayload.meal, source: "HOME", name: null },
      entries: [basePayload.entries[0]],
    };
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      type: "MEAL",
      mealSource: "HOME",
      mealName: null,
    }));
  });

  it("stores the approved per-child details as separate feed-compatible reports", async () => {
    mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
    const payload = {
      ...basePayload,
      entries: [{
        ...basePayload.entries[0],
        toiletOccurredAt: "2026-09-08T12:15:00.000Z",
        extraEvents: [{
          kind: "TOILET",
          occurredAt: "2026-09-08T13:15:00.000Z",
          details: "استخدم الحمام مرة أخرى",
        }],
        supplies: "ملابس إضافية",
        health: "احمرار بسيط وتمت المتابعة",
        medication: {
          name: "دواء مصرح",
          dose: "5 مل",
          occurredAt: "2026-09-08T14:00:00.000Z",
        },
      }],
    };

    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    const writes = mocks.create.mock.calls.map(([argument]) => argument.data);
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ dailyItemKey: "event-0", type: "TOILET", note: "استخدم الحمام مرة أخرى" }),
      expect.objectContaining({ dailyItemKey: "supplies", type: "SUPPLIES", supplyItem: "ملابس إضافية" }),
      expect.objectContaining({ dailyItemKey: "health", type: "HEALTH", symptom: "احمرار بسيط وتمت المتابعة" }),
      expect.objectContaining({
        dailyItemKey: "medication",
        type: "MEDICATION",
        medicationName: "دواء مصرح",
        medicationDose: "5 مل",
        givenByName: "Teacher One",
      }),
    ]));
  });

  it("rejects a nap without a valid start and end", async () => {
    const payload = {
      ...basePayload,
      entries: [{ ...basePayload.entries[0], napEndAt: null }],
    };
    const response = await POST(request(payload));
    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects the whole request when a child is outside the writable tenant roster", async () => {
    mocks.studentFindMany.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
    const response = await POST(request(basePayload));
    expect(response.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("replays an identical batch without writing or notifying twice", async () => {
    mocks.batchFindMany.mockResolvedValue([
      { id: "existing-1", studentId: "student-1", dailyBatchHash: expect.any(String) },
    ]);
    const { createHash } = await import("node:crypto");
    const canonical = {
      meal: basePayload.meal,
      entries: basePayload.entries
        .map((entry) => ({ ...entry, extraEvents: [] }))
        .sort((a, b) => a.studentId.localeCompare(b.studentId)),
    };
    mocks.batchFindMany.mockResolvedValue([
      {
        id: "existing-1",
        studentId: "student-1",
        dailyBatchHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
      },
    ]);

    const response = await POST(request(basePayload));
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("rejects reuse of a batch key for different content", async () => {
    mocks.batchFindMany.mockResolvedValue([
      { id: "existing-1", studentId: "student-1", dailyBatchHash: "different" },
    ]);
    const response = await POST(request(basePayload));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
