import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindMany: vi.fn(),
  studentGroupBy: vi.fn(),
  teacherGroupBy: vi.fn(),
  guardianGroupBy: vi.fn(),
  userGroupBy: vi.fn(),
  guardianAccountGroupBy: vi.fn(),
  arrivalRecipientGroupBy: vi.fn(),
  arrivalNoticeGroupBy: vi.fn(),
  careReportGroupBy: vi.fn(),
  deviceTokenGroupBy: vi.fn(),
  storedFileGroupBy: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: mocks.schoolFindMany },
    student: { groupBy: mocks.studentGroupBy },
    teacher: { groupBy: mocks.teacherGroupBy },
    guardian: { groupBy: mocks.guardianGroupBy },
    user: { groupBy: mocks.userGroupBy },
    guardianAccount: { groupBy: mocks.guardianAccountGroupBy },
    arrivalRecipientSetting: { groupBy: mocks.arrivalRecipientGroupBy },
    arrivalNotice: { groupBy: mocks.arrivalNoticeGroupBy },
    careReport: { groupBy: mocks.careReportGroupBy },
    deviceToken: { groupBy: mocks.deviceTokenGroupBy },
    storedFile: { groupBy: mocks.storedFileGroupBy },
  },
}));

import { GET } from "@/app/api/admin/data-quality/route";

const row = (schoolId: string, count: number) => ({ schoolId, _count: { _all: count } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.schoolFindMany.mockResolvedValue([
    {
      id: "school-1",
      name: "المدرسة الأولى",
      subscription_status: "active",
      subscription_plan: { max_storage_mb: 10 },
      storage_usage: { totalBytes: 12 * 1024 * 1024 },
    },
    {
      id: "school-2",
      name: "المدرسة الثانية",
      subscription_status: "active",
      subscription_plan: { max_storage_mb: 0 },
      storage_usage: { totalBytes: 20 * 1024 * 1024 },
    },
  ]);
  mocks.studentGroupBy.mockResolvedValue([row("school-1", 2)]);
  mocks.teacherGroupBy.mockResolvedValue([row("school-1", 1)]);
  mocks.guardianGroupBy.mockResolvedValue([row("school-2", 1)]);
  mocks.userGroupBy.mockResolvedValue([row("school-1", 1)]);
  mocks.guardianAccountGroupBy
    .mockResolvedValueOnce([row("school-1", 1)])
    .mockResolvedValueOnce([row("school-1", 2), row("school-2", 1)]);
  mocks.arrivalRecipientGroupBy.mockResolvedValue([row("school-2", 1)]);
  mocks.arrivalNoticeGroupBy.mockResolvedValue([row("school-1", 1)]);
  mocks.careReportGroupBy
    .mockResolvedValueOnce([row("school-1", 1)])
    .mockResolvedValueOnce([row("school-2", 2)]);
  mocks.deviceTokenGroupBy.mockResolvedValue([row("school-2", 1)]);
  mocks.storedFileGroupBy
    .mockResolvedValueOnce([row("school-1", 3)])
    .mockResolvedValueOnce([row("school-2", 1)]);
});

describe("super-admin data quality checks", () => {
  it("returns aggregated issues by school without personal data", async () => {
    const response = await GET(new Request("http://localhost/api/admin/data-quality"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalIssues: 18,
      highIssues: 9,
      warnings: 9,
      affectedSchools: 2,
      cleanSchools: 0,
      schoolCount: 2,
    });
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "students_without_class", total: 2, affectedSchools: 1 }),
      expect.objectContaining({ key: "arrival_recipients_not_configured", total: 1 }),
      expect.objectContaining({ key: "storage_over_quota", total: 2 }),
    ]));
    expect(body.schools[0]).toMatchObject({ id: "school-1", highIssues: 7, totalIssues: 13 });
    expect(body.privacy.aggregateOnly).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("studentName");
    expect(serialized).not.toContain("teacherName");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("healthCondition");
  });

  it("requires a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/data-quality"));

    expect(response.status).toBe(401);
    expect(mocks.schoolFindMany).not.toHaveBeenCalled();
  });
});
