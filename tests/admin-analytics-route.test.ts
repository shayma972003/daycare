import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindMany: vi.fn(),
  userGroupBy: vi.fn(),
  teacherGroupBy: vi.fn(),
  classGroupBy: vi.fn(),
  studentGroupBy: vi.fn(),
  guardianGroupBy: vi.fn(),
  attendanceGroupBy: vi.fn(),
  careGroupBy: vi.fn(),
  calendarGroupBy: vi.fn(),
  activityGroupBy: vi.fn(),
  arrivalGroupBy: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: mocks.schoolFindMany },
    user: { groupBy: mocks.userGroupBy },
    teacher: { groupBy: mocks.teacherGroupBy },
    class: { groupBy: mocks.classGroupBy },
    student: { groupBy: mocks.studentGroupBy },
    guardianAccount: { groupBy: mocks.guardianGroupBy },
    attendance: { groupBy: mocks.attendanceGroupBy },
    careReport: { groupBy: mocks.careGroupBy },
    calendarEvent: { groupBy: mocks.calendarGroupBy },
    activity: { groupBy: mocks.activityGroupBy },
    arrivalNotice: { groupBy: mocks.arrivalGroupBy },
    $queryRawUnsafe: mocks.raw,
  },
}));

import { GET } from "@/app/api/admin/analytics/route";

const countRow = (schoolId: string, count: number) => ({ schoolId, _count: { _all: count } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.schoolFindMany.mockResolvedValue([
    { id: "school-1", name: "مدرسة مكتملة", createdAt: new Date("2026-01-01"), subscription_status: "active" },
    { id: "school-2", name: "مدرسة تحت التفعيل", createdAt: new Date("2026-10-01"), subscription_status: "trial" },
  ]);
  mocks.userGroupBy.mockResolvedValue([countRow("school-1", 1)]);
  mocks.teacherGroupBy.mockResolvedValue([countRow("school-1", 2), countRow("school-2", 1)]);
  mocks.classGroupBy.mockResolvedValue([countRow("school-1", 2), countRow("school-2", 1)]);
  mocks.studentGroupBy.mockResolvedValue([countRow("school-1", 8), countRow("school-2", 2)]);
  mocks.guardianGroupBy.mockResolvedValue([countRow("school-1", 7)]);
  mocks.attendanceGroupBy
    .mockResolvedValueOnce([countRow("school-1", 20)])
    .mockResolvedValueOnce([countRow("school-1", 5)]);
  mocks.careGroupBy.mockResolvedValue([countRow("school-1", 10)]);
  mocks.calendarGroupBy.mockResolvedValue([countRow("school-2", 1)]);
  mocks.activityGroupBy.mockResolvedValue([]);
  mocks.arrivalGroupBy.mockResolvedValue([countRow("school-1", 2)]);
  mocks.raw
    .mockResolvedValueOnce([{ schoolId: "school-1", count: 3 }])
    .mockResolvedValueOnce([
      { reviewStatus: "APPROVED", count: 2 },
      { reviewStatus: "PENDING_REVIEW", count: 1 },
    ])
    .mockResolvedValueOnce([{ count: 1 }])
    .mockResolvedValueOnce([{ average_minutes: 45 }]);
});

describe("super-admin usage analytics", () => {
  it("builds an activation funnel and aggregate feature metrics without personal data", async () => {
    const response = await GET(new Request("http://localhost/api/admin/analytics"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      activeSchools: 2,
      usingCoreFeatures: 2,
      dormantSchools: 0,
      averageActivationPercent: 57,
    });
    expect(body.funnel).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "school", count: 2, conversionRate: 100 }),
      expect.objectContaining({ key: "manager", count: 1, conversionRate: 50 }),
      expect.objectContaining({ key: "care", count: 1, conversionRate: 50 }),
    ]));
    expect(body.features).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "attendance", schoolsUsing: 1, totalActions: 5 }),
      expect.objectContaining({ key: "calendar", schoolsUsing: 1, totalActions: 1 }),
    ]));
    expect(body.careReports).toMatchObject({ submitted: 3, approved: 2, pending: 1, overdue: 1, averageReviewMinutes: 45 });
    expect(body.schools.find((school: { id: string }) => school.id === "school-2")).toMatchObject({
      completedSteps: 1,
      nextStep: "تفعيل المديرة",
      dormant: false,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("guardianName");
    expect(serialized).not.toContain("studentName");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
  });

  it("requires a super-admin session before reading usage data", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/analytics"));

    expect(response.status).toBe(401);
    expect(mocks.schoolFindMany).not.toHaveBeenCalled();
  });
});
