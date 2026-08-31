import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  studentFind: vi.fn(),
  studentUpdate: vi.fn(),
  teacherFind: vi.fn(),
  teacherUpdate: vi.fn(),
  attendanceFindMany: vi.fn(),
  attendanceFindUnique: vi.fn(),
  attendanceFindUniqueOrThrow: vi.fn(),
  attendanceCreate: vi.fn(),
  attendanceUpdateMany: vi.fn(),
  teacherAttendanceFindMany: vi.fn(),
  teacherAttendanceFindUnique: vi.fn(),
  teacherAttendanceCreate: vi.fn(),
  teacherAttendanceUpdateMany: vi.fn(),
  schoolFind: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import {
  AttendanceOperationError,
  checkInStudent,
  checkoutStudent,
  checkoutTeacher,
} from "@/lib/attendance-operations";

const tx = {
  $queryRaw: mocks.queryRaw,
  student: { findFirst: mocks.studentFind, update: mocks.studentUpdate },
  teacher: { findFirst: mocks.teacherFind, update: mocks.teacherUpdate },
  attendance: {
    findMany: mocks.attendanceFindMany,
    findUnique: mocks.attendanceFindUnique,
    findUniqueOrThrow: mocks.attendanceFindUniqueOrThrow,
    create: mocks.attendanceCreate,
    updateMany: mocks.attendanceUpdateMany,
  },
  teacherAttendance: {
    findMany: mocks.teacherAttendanceFindMany,
    findUnique: mocks.teacherAttendanceFindUnique,
    create: mocks.teacherAttendanceCreate,
    updateMany: mocks.teacherAttendanceUpdateMany,
  },
  school: { findUnique: mocks.schoolFind },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.queryRaw.mockResolvedValue([{ id: "person-1" }]);
  mocks.studentFind.mockResolvedValue({ id: "person-1", name: "Student", classId: null, attendanceType: "REGULAR" });
  mocks.teacherFind.mockResolvedValue({ id: "person-1", name: "Teacher" });
  mocks.attendanceFindMany.mockResolvedValue([]);
  mocks.attendanceFindUnique.mockResolvedValue(null);
  mocks.teacherAttendanceFindMany.mockResolvedValue([]);
  mocks.teacherAttendanceFindUnique.mockResolvedValue(null);
  mocks.schoolFind.mockResolvedValue({
    studentCheckoutTime: "17:00",
    teacherCheckinTime: "08:00",
    teacherCheckoutTime: "17:00",
    settings: { hourlyLateFee: 0 },
  });
});
describe("shared attendance operations", () => {
  it("blocks a new student check-in while yesterday's session is still open", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{ id: "old-open" }]);
    await expect(checkInStudent({
      studentId: "person-1",
      schoolId: "school-1",
      date: new Date("2026-08-28T00:00:00.000Z"),
      now: new Date("2026-08-28T01:00:00.000Z"),
    })).rejects.toMatchObject({ code: "ALREADY_CHECKED_IN", status: 409 });
    expect(mocks.attendanceCreate).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("surfaces overlapping legacy sessions instead of choosing one silently", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{ id: "open-1" }, { id: "open-2" }]);
    await expect(checkInStudent({
      studentId: "person-1",
      schoolId: "school-1",
      date: new Date("2026-08-28T00:00:00.000Z"),
      now: new Date("2026-08-28T01:00:00.000Z"),
    })).rejects.toMatchObject({ code: "OVERLAPPING_OPEN_ATTENDANCE" });
  });

  it("closes an overnight student session once and increments actual hours in the same transaction", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{
      id: "attendance-1",
      checkinAt: new Date("2026-08-27T23:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.studentUpdate.mockResolvedValue({});

    const result = await checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:30:00.000Z"),
    });

    expect(result.totalHours).toBe(3.5);
    expect(mocks.attendanceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "attendance-1", schoolId: "school-1", checkoutAt: null }),
    }));
    expect(mocks.studentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attendanceHours: { increment: 3.5 } }),
    }));
  });

  it("does not increment totals when a concurrent checkout already won", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{
      id: "attendance-1",
      checkinAt: new Date("2026-08-28T01:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
    })).rejects.toBeInstanceOf(AttendanceOperationError);
    expect(mocks.studentUpdate).not.toHaveBeenCalled();
  });

  it("allows an inactive teacher's already-open session to be closed", async () => {
    mocks.teacherFind.mockResolvedValue({ id: "person-1", name: "Inactive Teacher", isActive: false });
    mocks.teacherAttendanceFindMany.mockResolvedValue([{
      id: "teacher-attendance-1",
      checkinAt: new Date("2026-08-27T22:00:00.000Z"),
    }]);
    mocks.teacherAttendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.teacherUpdate.mockResolvedValue({});

    const result = await checkoutTeacher({
      teacherId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
    });
    expect(result.totalHours).toBe(4);
    expect(mocks.teacherUpdate).toHaveBeenCalledTimes(1);
  });

  it("propagates a totals write failure from the transaction", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{
      id: "attendance-1",
      checkinAt: new Date("2026-08-28T01:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.studentUpdate.mockRejectedValue(new Error("synthetic totals failure"));

    await expect(checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
    })).rejects.toThrow("synthetic totals failure");
  });
});
