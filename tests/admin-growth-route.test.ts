import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindMany: vi.fn(),
  studentFindMany: vi.fn(),
  teacherFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: mocks.schoolFindMany },
    student: { findMany: mocks.studentFindMany },
    teacher: { findMany: mocks.teacherFindMany },
    schoolSubscriptionPayment: { findMany: mocks.paymentFindMany },
  },
}));

import { GET } from "@/app/api/admin/growth/route";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.schoolFindMany
    .mockResolvedValueOnce([
      { createdAt: new Date("2026-02-05T00:00:00Z") },
      { createdAt: new Date("2026-03-05T00:00:00Z") },
      { createdAt: new Date("2026-06-05T00:00:00Z") },
    ])
    .mockResolvedValueOnce([
      {
        subscription_status: "active",
        subscription_plan: { name: "شهري", price: 300, billing_interval: "MONTHLY" },
        _count: { students: 20 },
      },
      {
        subscription_status: "active",
        subscription_plan: { name: "سنوي", price: 1200, billing_interval: "YEARLY" },
        _count: { students: 10 },
      },
      {
        subscription_status: "trial",
        subscription_plan: null,
        _count: { students: 4 },
      },
    ]);
  mocks.studentFindMany.mockResolvedValue([
    { createdAt: new Date("2026-03-10T00:00:00Z") },
    { createdAt: new Date("2026-03-11T00:00:00Z") },
    { createdAt: new Date("2026-06-10T00:00:00Z") },
  ]);
  mocks.teacherFindMany.mockResolvedValue([{ createdAt: new Date("2026-05-01T00:00:00Z") }]);
  mocks.paymentFindMany.mockResolvedValue([
    { status: "PAID", amount: 500, created_at: new Date("2026-03-01T00:00:00Z"), paid_at: new Date("2026-03-02T00:00:00Z") },
    { status: "PAID", amount: 700, created_at: new Date("2026-06-01T00:00:00Z"), paid_at: new Date("2026-06-02T00:00:00Z") },
    { status: "FAILED", amount: 300, created_at: new Date("2026-06-03T00:00:00Z"), paid_at: null },
  ]);
});

afterEach(() => vi.useRealTimers());

describe("super-admin growth analytics", () => {
  it("returns aggregate growth, normalized MRR, and transparent forecasts", async () => {
    const response = await GET(new Request("http://localhost/api/admin/growth?months=6"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      mrr: 400,
      arr: 4800,
      paidSchools: 2,
      trialSchools: 1,
      averageRevenuePerPaidSchool: 200,
      trialToPaidPercent: 67,
      paymentSuccessPercent: 67,
    });
    expect(body.series).toHaveLength(6);
    expect(body.series.at(-1)).toMatchObject({ key: "2026-07", partial: true });
    expect(body.series.find((item: { key: string }) => item.key === "2026-03")).toMatchObject({
      newSchools: 1,
      newStudents: 2,
      revenue: 500,
    });
    expect(body.forecast).toMatchObject({
      method: "DAMPED_SIX_MONTH_TREND",
      excludesPartialCurrentMonth: true,
    });
    expect(body.forecast.months).toHaveLength(3);
    expect(body.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "شهري", schools: 1, students: 20, mrr: 300 }),
      expect.objectContaining({ name: "سنوي", schools: 1, students: 10, mrr: 100 }),
      expect.objectContaining({ name: "تجريبي", schools: 1, students: 4, mrr: 0 }),
    ]));

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("studentName");
    expect(serialized).not.toContain("teacherName");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("health");
  });

  it("requires a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/growth"));

    expect(response.status).toBe(401);
    expect(mocks.schoolFindMany).not.toHaveBeenCalled();
  });
});
