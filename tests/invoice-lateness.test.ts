import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  studentAggregate: vi.fn(),
  teacherAggregate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { aggregate: mocks.studentAggregate },
    teacherAttendance: { aggregate: mocks.teacherAggregate },
  },
}));

import { studentLatenessForInvoice, teacherLatenessForInvoice } from "@/lib/invoice-lateness";

beforeEach(() => vi.resetAllMocks());

describe("monthly invoice lateness", () => {
  it("uses the student's stored daily fees in the requested month", async () => {
    mocks.studentAggregate.mockResolvedValue({ _sum: { lateMinutes: 75, lateFee: 62.5 } });
    const result = await studentLatenessForInvoice("school-1", "student-1", new Date("2026-09-15T10:00:00Z"));
    expect(result).toMatchObject({ lateMinutes: 75, lateHours: 1.25, lateFee: 62.5 });
    expect(mocks.studentAggregate).toHaveBeenCalledWith({
      where: {
        schoolId: "school-1",
        studentId: "student-1",
        date: { gte: new Date("2026-09-01T00:00:00.000Z"), lte: new Date("2026-09-30T00:00:00.000Z") },
      },
      _sum: { lateMinutes: true, lateFee: true },
    });
  });

  it("excludes compensated teacher lateness and all other months", async () => {
    mocks.teacherAggregate.mockResolvedValue({ _sum: { lateMinutes: 30 } });
    const result = await teacherLatenessForInvoice("school-1", "teacher-1", new Date("2026-09-15T10:00:00Z"));
    expect(result.lateHours).toBe(0.5);
    expect(mocks.teacherAggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        teacherId: "teacher-1",
        compensated: false,
      }),
    }));
  });
});
