import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  checkIn: vi.fn(),
  checkout: vi.fn(),
  notify: vi.fn(),
  logAction: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: vi.fn(() => null),
}));
vi.mock("@/lib/device-date", () => ({
  calendarToday: vi.fn(() => new Date("2026-10-05T00:00:00.000Z")),
  requestTimeZone: vi.fn(() => "Asia/Riyadh"),
}));
vi.mock("@/lib/attendance-operations", () => ({
  AttendanceOperationError: class AttendanceOperationError extends Error {
    constructor(public code: string, public status: number) { super(code); }
  },
  checkInStudent: mocks.checkIn,
  checkoutStudent: mocks.checkout,
}));
vi.mock("@/lib/attendance-notifications", () => ({
  notifyGuardiansOfAttendance: mocks.notify,
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: mocks.logError }));
vi.mock("@/lib/student-access-scope", () => ({ scopedClassIds: vi.fn(() => null) }));

import { POST as listCheckin } from "@/app/api/attendance/students/checkin/route";
import { POST as listCheckout } from "@/app/api/attendance/students/checkout/route";
import { POST as detailCheckin } from "@/app/api/students/[id]/checkin/route";
import { POST as detailCheckout } from "@/app/api/students/[id]/checkout/route";

const session = {
  can: vi.fn(() => true),
  user: { id: "user-1", name: "Manager", schoolId: "school-1" },
};

function request(url: string) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: "student-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(session);
  mocks.checkIn.mockResolvedValue({
    id: "attendance-1",
    personName: "سارة",
    checkinAt: new Date("2026-10-05T06:00:00.000Z"),
    status: "PRESENT",
  });
  mocks.checkout.mockResolvedValue({
    attendanceId: "attendance-1",
    personName: "سارة",
    checkinAt: new Date("2026-10-05T06:00:00.000Z"),
    checkoutAt: new Date("2026-10-05T12:00:00.000Z"),
    totalHours: 6,
    lateHours: 0,
    lateFee: 0,
  });
  mocks.notify.mockResolvedValue(1);
  mocks.logAction.mockResolvedValue(undefined);
});

describe("dashboard attendance notification wiring", () => {
  it.each([
    ["attendance list check-in", () => listCheckin(request("http://localhost/api/attendance/students/checkin")), "checkin"],
    ["student detail check-in", () => detailCheckin(request("http://localhost/api/students/student-1/checkin"), { params: Promise.resolve({ id: "student-1" }) }), "checkin"],
    ["attendance list checkout", () => listCheckout(request("http://localhost/api/attendance/students/checkout")), "checkout"],
    ["student detail checkout", () => detailCheckout(request("http://localhost/api/students/student-1/checkout"), { params: Promise.resolve({ id: "student-1" }) }), "checkout"],
  ])("queues the guardian notification after %s", async (_label, call, event) => {
    const response = await call();
    expect(response.status).toBeLessThan(300);
    expect(mocks.notify).toHaveBeenCalledWith({
      schoolId: "school-1",
      studentId: "student-1",
      studentName: "سارة",
      event,
    });
  });

  it("does not undo a successful attendance mutation when push queueing fails", async () => {
    mocks.notify.mockRejectedValue(new Error("queue unavailable"));
    const response = await listCheckin(request("http://localhost/api/attendance/students/checkin"));
    expect(response.status).toBe(201);
    expect(mocks.logError).toHaveBeenCalledWith(
      "attendance-checkin-notification",
      expect.any(Error)
    );
  });
});
