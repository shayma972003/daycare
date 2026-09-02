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
  checkInTeacher,
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
  mocks.studentFind.mockResolvedValue({ id: "person-1", name: "Student", classId: null, period: "MORNING" });
  mocks.teacherFind.mockResolvedValue({ id: "person-1", name: "Teacher", period: "MORNING" });
  mocks.attendanceFindMany.mockResolvedValue([]);
  mocks.attendanceFindUnique.mockResolvedValue(null);
  mocks.teacherAttendanceFindMany.mockResolvedValue([]);
  mocks.teacherAttendanceFindUnique.mockResolvedValue(null);
  mocks.schoolFind.mockResolvedValue({
    studentMorningCheckinTime: "08:00",
    studentMorningCheckoutTime: "17:00",
    studentEveningCheckinTime: "16:00",
    studentEveningCheckoutTime: "22:00",
    teacherMorningCheckinTime: "08:00",
    teacherMorningCheckoutTime: "17:00",
    teacherEveningCheckinTime: "16:00",
    teacherEveningCheckoutTime: "22:00",
    settings: { hourlyLateFee: 0 },
  });
});
describe("shared attendance operations", () => {
  it("calculates teacher lateness at manual check-in from her own period", async () => {
    mocks.teacherFind.mockResolvedValue({ id: "person-1", name: "Teacher", period: "EVENING" });
    mocks.teacherAttendanceCreate.mockResolvedValue({ id: "teacher-attendance-1" });
    mocks.teacherUpdate.mockResolvedValue({});

    await checkInTeacher({
      teacherId: "person-1",
      schoolId: "school-1",
      date: new Date("2026-09-01T00:00:00.000Z"),
      now: new Date("2026-09-01T16:30:00.000Z"),
      timeZone: "UTC",
    });

    expect(mocks.teacherAttendanceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ checkinAt: new Date("2026-09-01T16:30:00.000Z"), lateMinutes: 30 }),
    }));
    expect(mocks.teacherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { lateHours: { increment: 0.5 } },
    }));
  });

  it("allows teacher check-in on the device-local contract end day and rejects the next day", async () => {
    const contractEnd = new Date("2026-09-01T00:00:00.000Z");
    mocks.teacherFind.mockImplementation(async ({ where }: { where: {
      OR: Array<{ enrollmentEndDate: null | { gte?: Date } }>;
    } }) => {
      const threshold = where.OR[1]?.enrollmentEndDate;
      const localDay = threshold && typeof threshold === "object" ? threshold.gte : undefined;
      return localDay && localDay <= contractEnd
        ? { id: "person-1", name: "Teacher", period: "MORNING" }
        : null;
    });
    mocks.teacherAttendanceCreate.mockResolvedValue({ id: "teacher-attendance-1" });

    await expect(checkInTeacher({
      teacherId: "person-1",
      schoolId: "school-1",
      date: new Date("2026-09-01T00:00:00.000Z"),
      now: new Date("2026-09-01T08:00:00.000Z"),
      timeZone: "Pacific/Auckland",
    })).resolves.toMatchObject({ id: "teacher-attendance-1" });

    mocks.teacherAttendanceCreate.mockClear();
    await expect(checkInTeacher({
      teacherId: "person-1",
      schoolId: "school-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      now: new Date("2026-09-01T12:30:00.000Z"),
      timeZone: "Pacific/Auckland",
    })).rejects.toMatchObject({ code: "NOT_ELIGIBLE", status: 409 });
    expect(mocks.teacherAttendanceCreate).not.toHaveBeenCalled();
  });

  it("calculates an evening student's fee only at manual checkout in the device zone", async () => {
    mocks.studentFind.mockResolvedValue({ id: "person-1", name: "Student", period: "EVENING" });
    mocks.schoolFind.mockResolvedValue({
      studentMorningCheckinTime: "08:00",
      studentMorningCheckoutTime: "17:00",
      studentEveningCheckinTime: "16:00",
      studentEveningCheckoutTime: "22:00",
      settings: { hourlyLateFee: 60 },
    });
    mocks.attendanceFindMany.mockResolvedValue([{
      id: "attendance-1",
      date: new Date("2026-09-01T00:00:00.000Z"),
      checkinAt: new Date("2026-09-01T08:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.studentUpdate.mockResolvedValue({});

    const result = await checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      // 22:30 in Tokyo. The same instant is not late against a fixed Riyadh cutoff.
      now: new Date("2026-09-01T13:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    });

    expect(result.lateHours).toBe(0.5);
    expect(result.lateFee).toBe(30);
    expect(mocks.attendanceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lateMinutes: 30, lateFee: 30 }),
    }));
  });

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
      date: new Date("2026-08-27T00:00:00.000Z"),
      checkinAt: new Date("2026-08-27T23:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.studentUpdate.mockResolvedValue({});

    const result = await checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:30:00.000Z"),
      timeZone: "UTC",
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
      date: new Date("2026-08-28T00:00:00.000Z"),
      checkinAt: new Date("2026-08-28T01:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
      timeZone: "UTC",
    })).rejects.toBeInstanceOf(AttendanceOperationError);
    expect(mocks.studentUpdate).not.toHaveBeenCalled();
  });

  it("allows an inactive teacher's already-open session to be closed", async () => {
    mocks.teacherFind.mockResolvedValue({ id: "person-1", name: "Inactive Teacher", isActive: false, period: "MORNING" });
    mocks.teacherAttendanceFindMany.mockResolvedValue([{
      id: "teacher-attendance-1",
      date: new Date("2026-08-27T00:00:00.000Z"),
      checkinAt: new Date("2026-08-27T22:00:00.000Z"),
      lateMinutes: 0,
    }]);
    mocks.teacherAttendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.teacherUpdate.mockResolvedValue({});

    const result = await checkoutTeacher({
      teacherId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
      timeZone: "UTC",
    });
    expect(result.totalHours).toBe(4);
    expect(mocks.teacherUpdate).toHaveBeenCalledTimes(1);
  });

  it("propagates a totals write failure from the transaction", async () => {
    mocks.attendanceFindMany.mockResolvedValue([{
      id: "attendance-1",
      date: new Date("2026-08-28T00:00:00.000Z"),
      checkinAt: new Date("2026-08-28T01:00:00.000Z"),
    }]);
    mocks.attendanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.studentUpdate.mockRejectedValue(new Error("synthetic totals failure"));

    await expect(checkoutStudent({
      studentId: "person-1",
      schoolId: "school-1",
      now: new Date("2026-08-28T02:00:00.000Z"),
      timeZone: "UTC",
    })).rejects.toThrow("synthetic totals failure");
  });
});
