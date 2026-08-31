import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkInStudent: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/attendance-operations", () => {
  class AttendanceOperationError extends Error {
    constructor(public code: string, public status: number) {
      super(code);
    }
  }
  return {
    AttendanceOperationError,
    checkInStudent: mocks.checkInStudent,
  };
});
import { AttendanceOperationError } from "@/lib/attendance-operations";
import { POST } from "@/app/api/attendance/students/checkin/route";

const request = () => new Request("http://localhost/api/attendance/students/checkin", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Time-Zone": "UTC" },
  body: JSON.stringify({ student_id: "student-1" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { schoolId: "school-1" },
    can: (permission: string) => permission === "attendance.students",
  });
});

describe("student check-in route", () => {
  it("maps an existing open session to a safe conflict", async () => {
    mocks.checkInStudent.mockRejectedValue(
      new AttendanceOperationError("ALREADY_CHECKED_IN", 409)
    );
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ALREADY_CHECKED_IN" });
  });

  it("does not expose or invoke the operation without permission", async () => {
    mocks.session.mockResolvedValue({ user: { schoolId: "school-1" }, can: () => false });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.checkInStudent).not.toHaveBeenCalled();
  });

  it("passes one server timestamp to the shared operation", async () => {
    mocks.checkInStudent.mockResolvedValue({
      id: "attendance-1",
      checkinAt: new Date("2026-08-28T06:00:00.000Z"),
      status: "PRESENT",
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.checkInStudent).toHaveBeenCalledWith(expect.objectContaining({
      studentId: "student-1",
      schoolId: "school-1",
      now: expect.any(Date),
      date: expect.any(Date),
    }));
  });
});
