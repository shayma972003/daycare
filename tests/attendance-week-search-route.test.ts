import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  students: vi.fn(),
  records: vi.fn(),
  class: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findMany: mocks.students },
    attendance: { findMany: mocks.records },
    class: { findFirst: mocks.class },
  },
}));
vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));

import { GET } from "@/app/api/attendance/week/route";

type QueryObject = Record<string, unknown>;

function isObject(value: unknown): value is QueryObject {
  return typeof value === "object" && value !== null;
}

function comparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

function matches(row: QueryObject, where: QueryObject): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return Array.isArray(value) && value.some((part) => isObject(part) && matches(row, part));
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every((part) => isObject(part) && matches(row, part));
    const actual = row[key];
    if (!isObject(value)) return actual === value;
    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
    if ("some" in value) {
      const someQuery = value.some;
      return Array.isArray(actual) && isObject(someQuery) && actual.some((part) => isObject(part) && matches(part, someQuery));
    }
    if ("contains" in value && !String(actual).toLowerCase().includes(String(value.contains).toLowerCase())) return false;
    const actualComparable = comparable(actual);
    if ("gte" in value) {
      const minimum = comparable(value.gte);
      if (actualComparable === null || minimum === null || actualComparable < minimum) return false;
    }
    if ("lt" in value) {
      const maximum = comparable(value.lt);
      if (actualComparable === null || maximum === null || actualComparable >= maximum) return false;
    }
    return true;
  });
}

describe("student weekly attendance server search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({
      user: { schoolId: "school-1" },
      can: (permission: string) => permission === "attendance.students",
    });
    mocks.class.mockResolvedValue(null);
    mocks.records.mockResolvedValue([
      { studentId: "ali", date: new Date("2026-08-23T00:00:00.000Z"), status: "PRESENT", statusNote: null, checkinAt: new Date("2026-08-23T06:00:00.000Z"), checkoutAt: null },
      { studentId: "sara", date: new Date("2026-08-23T00:00:00.000Z"), status: "PRESENT", statusNote: null, checkinAt: new Date("2026-08-23T06:00:00.000Z"), checkoutAt: null },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it("applies the name to historical-attendance and current-roster branches alike", async () => {
    const attendance = [{ schoolId: "school-1", date: new Date("2026-08-23T00:00:00.000Z"), classId: null }];
    const fixture = [
      { id: "ali", name: "Review Ali", schoolId: "school-1", classId: null, avatarUrl: null, attendanceDays: [], enrollment_date: null, enrollmentEndDate: null, isActive: false, status: "WITHDRAWN", deletedAt: null, anonymizedAt: null, attendances: attendance },
      { id: "sara", name: "Review Sara", schoolId: "school-1", classId: null, avatarUrl: null, attendanceDays: [], enrollment_date: null, enrollmentEndDate: null, isActive: false, status: "WITHDRAWN", deletedAt: null, anonymizedAt: null, attendances: attendance },
    ];
    mocks.students.mockImplementation(({ where }: { where: QueryObject }) =>
      Promise.resolve(fixture.filter((row) => matches(row, where)))
    );

    const response = await GET(new Request(
      "http://localhost/api/attendance/week?start=2026-08-23&search=Ali",
      { headers: { "X-Time-Zone": "UTC" } }
    ));
    expect(response.status).toBe(200);
    expect((await response.json()).rows.map((row: { name: string }) => row.name)).toEqual(["Review Ali"]);
    expect(mocks.students.mock.calls[0][0].where).toMatchObject({
      schoolId: "school-1",
      name: { contains: "Ali", mode: "insensitive" },
    });
  });

  it("marks only device-today and past cells editable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-30T01:00:00.000Z"));
    mocks.records.mockResolvedValue([]);
    mocks.students.mockResolvedValue([{
      id: "active",
      name: "Active Child",
      classId: null,
      avatarUrl: null,
      attendanceDays: [0, 1],
      enrollment_date: null,
      enrollmentEndDate: null,
      isActive: true,
      status: "ACTIVE",
      deletedAt: null,
      anonymizedAt: null,
    }]);

    const response = await GET(new Request(
      "http://localhost/api/attendance/week?start=2026-08-30",
      { headers: { "X-Time-Zone": "Asia/Riyadh" } }
    ));
    const body = await response.json() as { rows: Array<{ cells: Array<{ date: string; editable: boolean }> }> };
    expect(body.rows[0].cells[0]).toMatchObject({ date: "2026-08-30", editable: true });
    expect(body.rows[0].cells[1]).toMatchObject({ date: "2026-08-31", editable: false });
  });
});
