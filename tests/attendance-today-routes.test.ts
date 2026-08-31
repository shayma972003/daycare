import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  students: vi.fn(),
  teachers: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { findMany: mocks.students },
    teacherAttendance: { findMany: mocks.teachers },
  },
}));

import { GET as getStudents } from "@/app/api/attendance/students/today/route";
import { GET as getTeachers } from "@/app/api/attendance/teachers/today/route";

const request = () => new Request("http://localhost/api/attendance/today", {
  headers: { "X-Time-Zone": "UTC" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
  mocks.session.mockResolvedValue({
    user: { schoolId: "school-1" },
    can: () => true,
  });
  mocks.students.mockResolvedValue([]);
  mocks.teachers.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("today attendance routes retain open overnight sessions", () => {
  it("returns a student's open previous-day session instead of hiding it", async () => {
    mocks.students.mockResolvedValue([
      { id: "today", studentId: "student-1", date: new Date("2026-08-28T00:00:00.000Z"), checkinAt: new Date("2026-08-28T06:00:00.000Z"), checkoutAt: new Date("2026-08-28T07:00:00.000Z"), lateMinutes: 0, lateFee: 0 },
      { id: "open", studentId: "student-1", date: new Date("2026-08-27T00:00:00.000Z"), checkinAt: new Date("2026-08-27T22:00:00.000Z"), checkoutAt: null, lateMinutes: 0, lateFee: 0 },
    ]);
    const response = await getStudents(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: "open", studentId: "student-1", checkoutAt: null });
    expect(mocks.students.mock.calls[0][0].where).toMatchObject({
      schoolId: "school-1",
      OR: expect.arrayContaining([{ checkinAt: { not: null }, checkoutAt: null }]),
    });
  });

  it("returns an inactive teacher's open session and protects the route separately", async () => {
    mocks.teachers.mockResolvedValue([
      { id: "open-teacher", teacherId: "teacher-1", date: new Date("2026-08-27T00:00:00.000Z"), checkinAt: new Date("2026-08-27T22:00:00.000Z"), checkoutAt: null, lateMinutes: 0 },
    ]);
    const response = await getTeachers(request());
    expect((await response.json())[0]).toMatchObject({ id: "open-teacher", checkoutAt: null });
    expect(mocks.teachers.mock.calls[0][0].where.teacher).toEqual({
      deletedAt: null,
      anonymizedAt: null,
    });

    mocks.session.mockResolvedValue({
      user: { schoolId: "school-1" },
      can: (permission: string) => permission === "attendance.students",
    });
    const forbidden = await getTeachers(request());
    expect(forbidden.status).toBe(403);
    expect(mocks.teachers).toHaveBeenCalledTimes(1);
  });
});
