import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  accessFindFirst: vi.fn(),
  accessUpdateMany: vi.fn(),
  studentCount: vi.fn(),
  teacherCount: vi.fn(),
  classCount: vi.fn(),
  guardianCount: vi.fn(),
  userCount: vi.fn(),
  deviceCount: vi.fn(),
  careCount: vi.fn(),
  arrivalCount: vi.fn(),
  pushCount: vi.fn(),
  logFindMany: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportAccessSession: { findFirst: mocks.accessFindFirst, updateMany: mocks.accessUpdateMany },
    student: { count: mocks.studentCount },
    teacher: { count: mocks.teacherCount },
    class: { count: mocks.classCount },
    guardianAccount: { count: mocks.guardianCount },
    user: { count: mocks.userCount },
    deviceToken: { count: mocks.deviceCount },
    careReport: { count: mocks.careCount },
    arrivalRecipientSetting: { count: mocks.arrivalCount },
    pushNotification: { count: mocks.pushCount },
    adminActivityLog: { findMany: mocks.logFindMany },
  },
}));

import { GET } from "@/app/api/admin/support-access/[id]/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.accessFindFirst.mockResolvedValue({
    id: "access-1",
    reason: "التحقق من مشكلة الدخول",
    createdAt: new Date("2026-10-26T12:00:00Z"),
    expiresAt: new Date("2099-10-26T12:30:00Z"),
    revokedAt: null,
    ticket: { id: "ticket-1", reference: "SUP-1", title: "مشكلة دخول" },
    school: {
      id: "school-1",
      name: "مدرسة النور",
      plan: "standard",
      subscription_status: "active",
      renewal_date: null,
      last_login_at: null,
      settings: { careReportReviewRequired: true },
    },
  });
  mocks.studentCount.mockResolvedValue(12);
  mocks.teacherCount.mockResolvedValue(3);
  mocks.classCount.mockResolvedValue(2);
  mocks.guardianCount.mockResolvedValue(10);
  mocks.userCount.mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
  mocks.deviceCount.mockResolvedValueOnce(7).mockResolvedValueOnce(1);
  mocks.careCount.mockResolvedValue(2);
  mocks.arrivalCount.mockResolvedValue(2);
  mocks.pushCount.mockResolvedValue(1);
  mocks.logFindMany.mockResolvedValue([{ id: "log-1", action: "login", performed_by: "admin-1", performed_at: new Date() }]);
  mocks.accessUpdateMany.mockResolvedValue({ count: 1 });
});

describe("read-only support session details", () => {
  it("returns aggregate diagnostics and explicit restrictions without child or health records", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1"),
      { params: Promise.resolve({ id: "access-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      activeStudents: 12,
      activeTeachers: 3,
      activeClasses: 2,
      devices: { total: 7, failed: 1 },
    });
    expect(body.restrictions).toEqual({
      readOnly: true,
      sensitiveHealthHidden: true,
      personalRecordsHidden: true,
      writesAllowed: false,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("studentName");
    expect(serialized).not.toContain("guardianName");
    expect(serialized).not.toContain("health");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
  });

  it("rejects expired sessions before loading tenant diagnostics", async () => {
    mocks.accessFindFirst.mockResolvedValue({
      id: "access-1",
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      revokedAt: null,
      school: { id: "school-1" },
    });

    const response = await GET(
      new Request("http://localhost/api/admin/support-access/access-1"),
      { params: Promise.resolve({ id: "access-1" }) },
    );

    expect(response.status).toBe(410);
    expect(mocks.studentCount).not.toHaveBeenCalled();
  });
});
