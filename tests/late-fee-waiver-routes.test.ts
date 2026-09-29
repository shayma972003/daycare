import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  studentFind: vi.fn(),
  studentUpdate: vi.fn(),
  attendanceUpdateMany: vi.fn(),
  teacherFind: vi.fn(),
  teacherUpdate: vi.fn(),
  teacherAttendanceUpdateMany: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findFirst: mocks.studentFind, update: mocks.studentUpdate },
    attendance: { updateMany: mocks.attendanceUpdateMany },
    teacher: { findFirst: mocks.teacherFind, update: mocks.teacherUpdate },
    teacherAttendance: { updateMany: mocks.teacherAttendanceUpdateMany },
  },
}));

vi.mock("@/lib/student-access-scope", () => ({
  studentClassWhere: () => ({}),
}));

vi.mock("@/lib/activity-logger", () => ({
  logAction: mocks.logAction,
}));

import { DELETE as waiveStudentLateness } from "@/app/api/students/[id]/late-fee/route";
import { DELETE as waiveTeacherLateness } from "@/app/api/teachers/[id]/late-fee/route";

describe("current-month lateness waivers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({
      user: { id: "user-1", name: "Manager", schoolId: "school-1" },
    });
    mocks.studentFind.mockResolvedValue({ id: "student-1", name: "Child" });
    mocks.teacherFind.mockResolvedValue({ id: "teacher-1", name: "Teacher" });
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 2 });
    mocks.teacherAttendanceUpdateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waives only the student's current-month fee and preserves late minutes and lifetime hours", async () => {
    const response = await waiveStudentLateness(
      new Request("http://localhost/api/students/student-1/late-fee", { method: "DELETE" }),
      { params: Promise.resolve({ id: "student-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, waivedAttendanceCount: 2 });
    expect(mocks.attendanceUpdateMany).toHaveBeenCalledWith({
      where: {
        studentId: "student-1",
        schoolId: "school-1",
        date: {
          gte: new Date("2026-09-01T00:00:00.000Z"),
          lte: new Date("2026-09-30T00:00:00.000Z"),
        },
        lateFee: { gt: 0 },
      },
      data: { lateFee: 0 },
    });
    expect(mocks.studentUpdate).not.toHaveBeenCalled();
    expect(mocks.attendanceUpdateMany.mock.calls[0][0].data).not.toHaveProperty("lateMinutes");
  });

  it("waives only the teacher's current-month deduction and preserves recorded late minutes", async () => {
    const response = await waiveTeacherLateness(
      new Request("http://localhost/api/teachers/teacher-1/late-fee", { method: "DELETE" }),
      { params: Promise.resolve({ id: "teacher-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, waivedAttendanceCount: 1 });
    expect(mocks.teacherAttendanceUpdateMany).toHaveBeenCalledWith({
      where: {
        teacherId: "teacher-1",
        schoolId: "school-1",
        date: {
          gte: new Date("2026-09-01T00:00:00.000Z"),
          lte: new Date("2026-09-30T00:00:00.000Z"),
        },
        compensated: false,
        lateMinutes: { gt: 0 },
      },
      data: { compensated: true },
    });
    expect(mocks.teacherUpdate).not.toHaveBeenCalled();
    expect(mocks.teacherAttendanceUpdateMany.mock.calls[0][0].data).not.toHaveProperty("lateMinutes");
  });
});
