import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  students: vi.fn(),
  teachers: vi.fn(),
  classes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findMany: mocks.students },
    teacher: { findMany: mocks.teachers },
    class: { findMany: mocks.classes },
  },
}));
vi.mock("@/lib/file-token", () => ({ stampFileUrl: (value: string | null) => value }));

import { getAttendancePageData } from "@/lib/attendance-data";

describe("attendance page data separates history from new-entry eligibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.teachers.mockResolvedValue([]);
    mocks.classes.mockResolvedValue([]);
  });

  it("keeps a check-in visible and counted after the student becomes ineligible", async () => {
    const today = new Date("2026-08-28T00:00:00.000Z");
    mocks.students.mockResolvedValue([
      {
        id: "student-1",
        name: "Attended then suspended",
        avatarUrl: null,
        classId: null,
        enrollmentEndDate: new Date("2026-08-27T00:00:00.000Z"),
        isActive: false,
        status: "WITHDRAWN",
        period: "MORNING",
        class: null,
        attendances: [{ date: today, checkinAt: new Date("2026-08-28T06:00:00.000Z"), checkoutAt: null }],
      },
    ]);

    const data = await getAttendancePageData("school-1", { students: true, teachers: false }, today);
    expect(data.students).toHaveLength(1);
    expect(data.students?.[0]).toMatchObject({
      id: "student-1",
      eligible_for_attendance: false,
      today_attendance: { checkin_time: "2026-08-28T06:00:00.000Z", checkout_time: null },
    });

    const where = mocks.students.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([
      {
        attendances: {
          some: {
            schoolId: "school-1",
            checkinAt: { not: null },
            OR: [{ date: today }, { checkoutAt: null }],
          },
        },
      },
    ]));
  });

  it("returns yesterday's open session separately without relabelling it as today", async () => {
    const today = new Date("2026-08-28T00:00:00.000Z");
    mocks.students.mockResolvedValue([{
      id: "student-overnight",
      name: "Overnight",
      avatarUrl: null,
      classId: null,
      enrollmentEndDate: null,
      isActive: true,
      status: "ACTIVE",
      period: "MORNING",
      class: null,
      attendances: [{
        date: new Date("2026-08-27T00:00:00.000Z"),
        checkinAt: new Date("2026-08-27T22:00:00.000Z"),
        checkoutAt: null,
      }],
    }]);

    const data = await getAttendancePageData("school-1", { students: true, teachers: false }, today);
    expect(data.students?.[0]).toMatchObject({
      today_attendance: null,
      open_attendance: {
        date: "2026-08-27",
        checkin_time: "2026-08-27T22:00:00.000Z",
        checkout_time: null,
      },
    });
  });

  it("keeps an inactive teacher's real attendance visible without making them eligible", async () => {
    const today = new Date("2026-08-28T00:00:00.000Z");
    mocks.students.mockResolvedValue([]);
    mocks.teachers.mockResolvedValue([{
      id: "teacher-1",
      name: "Inactive after check-in",
      period: "MORNING",
      isActive: false,
      status: "TERMINATED",
      classes: [],
      teacherAttendances: [{
        date: today,
        checkinAt: new Date("2026-08-28T06:30:00.000Z"),
        checkoutAt: null,
      }],
    }]);

    const data = await getAttendancePageData("school-1", { students: false, teachers: true }, today);
    expect(data.teachers?.[0]).toMatchObject({
      id: "teacher-1",
      eligible_for_attendance: false,
      today_attendance: { checkin_time: "2026-08-28T06:30:00.000Z" },
      open_attendance: { date: "2026-08-28" },
    });
    expect(mocks.teachers.mock.calls[0][0].where.OR).toBeDefined();
  });
});
