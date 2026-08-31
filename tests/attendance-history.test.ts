import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/attendance/week/route";

const mocks = vi.hoisted(() => ({ students: vi.fn(), records: vi.fn(), class: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { student: { findMany: mocks.students }, attendance: { findMany: mocks.records }, class: { findFirst: mocks.class } } }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { schoolId: "school" }, can: () => true });
  mocks.class.mockResolvedValue(null);
});

describe("historical attendance independent of current eligibility", () => {
  it.each([
    { status: "ACTIVE", isActive: true, deletedAt: null, anonymizedAt: null },
    { status: "WITHDRAWN", isActive: false, deletedAt: null, anonymizedAt: null },
    { status: "GRADUATED", isActive: false, deletedAt: new Date("2026-08-10"), anonymizedAt: null },
    { status: "TRANSFERRED", isActive: false, deletedAt: null, anonymizedAt: new Date("2026-08-10") },
  ])("retains actual days and times for $status, including archived records", async (state) => {
    // Current class and current enrollment period no longer match the record.
    mocks.students.mockResolvedValue([{ ...state, id: "child", name: "Child", classId: "new-class", avatarUrl: null, attendanceDays: [1], enrollment_date: new Date("2026-09-01"), enrollmentEndDate: new Date("2026-09-30") }]);
    mocks.records.mockResolvedValue([{ studentId: "child", date: new Date("2026-08-02"), status: "CHECKED_OUT", statusNote: null, checkinAt: new Date("2026-08-02T05:13:00Z"), checkoutAt: new Date("2026-08-02T10:24:00Z") }]);
    const response = await GET(new Request("http://localhost/api/attendance/week?start=2026-08-02&classId=old-class"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data.rows[0].cells[0]).toMatchObject({ expected: true, status: "CHECKED_OUT", checkinAt: "2026-08-02T05:13:00.000Z", checkoutAt: "2026-08-02T10:24:00.000Z" });
    expect(data.rows[0].ratio).toEqual({ attended: 1, expected: 1 });
    expect(data.rows[0].cells.slice(1).every((cell: { expected: boolean }) => !cell.expected)).toBe(true);
    const where = mocks.students.mock.calls[0][0].where;
    expect(where.schoolId).toBe("school");
    expect(where.deletedAt).toBeUndefined();
    expect(where.isActive).toBeUndefined();
    // Historical branch must use the attendance's class, not today's class.
    expect(where.OR[0]).toEqual({ attendances: { some: { schoolId: "school", classId: "old-class", date: { gte: new Date("2026-08-02"), lt: new Date("2026-08-09") } } } });
    expect(mocks.records.mock.calls[0][0].where).toMatchObject({ schoolId: "school", classId: "old-class" });
  });
  it("does not query attendance without permission", async () => {
    mocks.session.mockResolvedValue({ user: { schoolId: "school" }, can: () => false });
    expect((await GET(new Request("http://localhost/api/attendance/week"))).status).toBe(403);
    expect(mocks.students).not.toHaveBeenCalled();
    expect(mocks.records).not.toHaveBeenCalled();
  });
});
