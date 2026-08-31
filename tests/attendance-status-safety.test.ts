import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  students: vi.fn(),
  records: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));

import { POST } from "@/app/api/attendance/students/status/route";

const tx = {
  student: { findMany: mocks.students },
  attendance: {
    findMany: mocks.records,
    update: mocks.update,
    create: mocks.create,
    deleteMany: mocks.deleteMany,
  },
};

function request(
  status: "PRESENT" | "ABSENT" | "LEAVE" | "NO_RECORD",
  date = "2026-08-20",
  timeZone = "UTC"
) {
  return new Request("http://localhost/api/attendance/students/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Time-Zone": timeZone },
    body: JSON.stringify({ studentIds: ["student-1"], status, date }),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-30T01:00:00.000Z"));
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { schoolId: "school-1", name: "Manager" },
    can: (permission: string) => permission === "attendance.students",
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.students.mockResolvedValue([{ id: "student-1", classId: "class-1" }]);
  mocks.records.mockResolvedValue([]);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
});

afterEach(() => vi.useRealTimers());

describe("weekly attendance status safety", () => {
  it.each(["ABSENT", "LEAVE", "NO_RECORD"] as const)(
    "refuses %s when it would erase actual check-in or checkout times",
    async (status) => {
      mocks.records.mockResolvedValue([{
        id: "attendance-1",
        studentId: "student-1",
        status: "CHECKED_OUT",
        checkinAt: new Date("2026-08-20T06:00:00.000Z"),
        checkoutAt: new Date("2026-08-20T12:00:00.000Z"),
      }]);
      const response = await POST(request(status));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "ATTENDANCE_TIMES_PROTECTED" });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    }
  );

  it("rejects manual PRESENT without entering the transaction", async () => {
    const response = await POST(request("PRESENT"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MANUAL_PRESENT_NOT_ALLOWED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a future device-calendar date", async () => {
    const response = await POST(request("ABSENT", "2026-08-30", "America/Los_Angeles"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "FUTURE_ATTENDANCE_NOT_ALLOWED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["ABSENT", "2026-08-30"],
    ["LEAVE", "2026-08-20"],
    ["NO_RECORD", "2026-08-20"],
  ] as const)("accepts manual %s for today or the past", async (status, date) => {
    const response = await POST(request(status, date, "Asia/Riyadh"));
    expect(response.status).toBe(200);
    expect(mocks.students).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ schoolId: "school-1" }),
    }));
  });

  it("rejects callers without the student attendance permission", async () => {
    mocks.session.mockResolvedValue({ user: { schoolId: "school-1" }, can: () => false });
    const response = await POST(request("ABSENT"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
