import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schoolFindUnique = vi.fn();
  const schoolUpdate = vi.fn();
  const planFindFirst = vi.fn();
  const activityCreate = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    school: { findUnique: schoolFindUnique, update: schoolUpdate },
    subscriptionPlan: { findFirst: planFindFirst },
    adminActivityLog: { create: activityCreate },
  };
  return {
    verifyAdmin: vi.fn(),
    transaction: vi.fn(),
    schoolFindUnique,
    schoolUpdate,
    planFindFirst,
    activityCreate,
    tx,
  };
});

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminSessionFromRequest: mocks.verifyAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { PUT } from "@/app/api/admin/subscriptions/[schoolId]/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/subscriptions/school-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.verifyAdmin.mockResolvedValue({ adminId: "admin-1" });
  mocks.transaction.mockImplementation((callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  mocks.schoolFindUnique.mockResolvedValue({
    id: "school-1",
    plan_id: null,
    subscription_status: "active",
    renewal_date: null,
    subscription_plan: null,
  });
  mocks.schoolUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "school-1", ...data }));
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.tx.$queryRaw.mockResolvedValue([{ id: "school-1" }]);
  mocks.planFindFirst.mockResolvedValue({ id: "monthly-plan", billing_interval: "MONTHLY" });
});

describe("Super Admin school subscription type", () => {
  it("starts a fresh one-calendar-month trial and clears any suspension", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-31T10:30:00.000Z") });

    const response = await PUT(
      request({ action: "change_type", subscription_type: "TRIAL" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.schoolUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "school-1" },
      data: {
        plan_id: null,
        subscription_status: "trial",
        renewal_date: new Date("2026-02-28T10:30:00.000Z"),
        suspended_at: null,
        suspension_reason: null,
      },
    }));
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "subscription_type_changed",
        performed_by: "super_admin",
        metadata: expect.objectContaining({ subscriptionType: "TRIAL" }),
      }),
    });
    expect(mocks.planFindFirst).not.toHaveBeenCalled();
  });

  it("selects the canonical monthly plan and updates status and renewal together", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-06T12:00:00.000Z") });

    const response = await PUT(
      request({ action: "change_type", subscription_type: "MONTHLY" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.planFindFirst).toHaveBeenCalledWith({
      where: { is_active: true, billing_interval: "MONTHLY" },
      select: { id: true, billing_interval: true },
    });
    expect(mocks.schoolUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan_id: "monthly-plan",
        subscription_status: "active",
        renewal_date: new Date("2026-10-06T12:00:00.000Z"),
        suspended_at: null,
        suspension_reason: null,
      }),
    }));
  });

  it("rejects an incomplete type change without opening a transaction", async () => {
    const response = await PUT(
      request({ action: "change_type" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
