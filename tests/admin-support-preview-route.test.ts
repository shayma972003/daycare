import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  accessFindFirst: vi.fn(),
  accessUpdateMany: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
  studentCount: vi.fn(),
  teacherCount: vi.fn(),
  classCount: vi.fn(),
  guardianCount: vi.fn(),
  careCount: vi.fn(),
  attendanceGroupBy: vi.fn(),
  calendarGroupBy: vi.fn(),
  invoiceAggregate: vi.fn(),
  expenseAggregate: vi.fn(),
  userCount: vi.fn(),
  deviceCount: vi.fn(),
  schoolFindUnique: vi.fn(),
  settingsFindUnique: vi.fn(),
  arrivalCount: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportAccessSession: { findFirst: mocks.accessFindFirst },
    student: { count: mocks.studentCount },
    teacher: { count: mocks.teacherCount },
    class: { count: mocks.classCount },
    guardianAccount: { count: mocks.guardianCount },
    careReport: { count: mocks.careCount },
    attendance: { groupBy: mocks.attendanceGroupBy },
    calendarEvent: { groupBy: mocks.calendarGroupBy },
    invoice: { aggregate: mocks.invoiceAggregate },
    expense: { aggregate: mocks.expenseAggregate },
    user: { count: mocks.userCount },
    deviceToken: { count: mocks.deviceCount },
    school: { findUnique: mocks.schoolFindUnique },
    settings: { findUnique: mocks.settingsFindUnique },
    arrivalRecipientSetting: { count: mocks.arrivalCount },
    $transaction: mocks.transaction,
  },
}));

import { GET } from "@/app/api/admin/support-access/[id]/preview/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.accessFindFirst.mockResolvedValue({
    id: "access-1",
    schoolId: "school-1",
    ticketId: "ticket-1",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    revokedAt: null,
  });
  mocks.accessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    supportAccessSession: { updateMany: mocks.accessUpdateMany },
    adminActivityLog: { create: mocks.activityCreate },
  }));
  mocks.studentCount.mockResolvedValue(9);
  mocks.teacherCount.mockResolvedValue(3);
  mocks.classCount.mockResolvedValue(2);
  mocks.guardianCount.mockResolvedValue(7);
  mocks.careCount.mockResolvedValue(1);
  mocks.attendanceGroupBy.mockResolvedValue([
    { status: "PRESENT", _count: { _all: 12 } },
    { status: "ABSENT", _count: { _all: 2 } },
  ]);
});

describe("secure support preview", () => {
  it("returns only aggregate attendance data and audits the page view", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1/preview?view=attendance"),
      { params: Promise.resolve({ id: "access-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.view).toBe("attendance");
    expect(body.sections[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "حضور", value: 12 }),
      expect.objectContaining({ label: "غياب", value: 2 }),
    ]));
    expect(mocks.activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "support_preview_page_viewed",
        performed_by: "admin-1",
        metadata: expect.objectContaining({ accessSessionId: "access-1", view: "attendance" }),
      }),
    }));
    const serialized = JSON.stringify(body).toLowerCase();
    for (const sensitiveKey of ["studentname", "guardianname", "email", "phone", "health", "note", "medication", "temperature"]) {
      expect(serialized).not.toContain(sensitiveKey);
    }
  });

  it("rejects an unknown preview section before querying tenant data", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1/preview?view=children"),
      { params: Promise.resolve({ id: "access-1" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.accessFindFirst).not.toHaveBeenCalled();
  });

  it("rejects expired access before querying tenant aggregates", async () => {
    mocks.accessFindFirst.mockResolvedValue({
      id: "access-1",
      schoolId: "school-1",
      ticketId: null,
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      revokedAt: null,
    });

    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1/preview?view=overview"),
      { params: Promise.resolve({ id: "access-1" }) },
    );

    expect(response.status).toBe(410);
    expect(mocks.studentCount).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the audit transaction cannot confirm an active session", async () => {
    mocks.accessUpdateMany.mockResolvedValue({ count: 0 });

    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1/preview?view=overview"),
      { params: Promise.resolve({ id: "access-1" }) },
    );

    expect(response.status).toBe(410);
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
