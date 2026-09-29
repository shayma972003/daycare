import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schoolFindUnique = vi.fn();
  const schoolUpdate = vi.fn();
  const planFindFirst = vi.fn();
  const activityCreate = vi.fn();
  const recipientFindFirst = vi.fn();
  const messageCreate = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    school: { findUnique: schoolFindUnique, update: schoolUpdate },
    subscriptionPlan: { findFirst: planFindFirst },
    adminActivityLog: { create: activityCreate },
    adminMessageRecipient: { findFirst: recipientFindFirst },
    adminMessage: { create: messageCreate },
  };
  return {
    verifyAdmin: vi.fn(),
    transaction: vi.fn(),
    schoolFindUnique,
    schoolUpdate,
    planFindFirst,
    activityCreate,
    recipientFindFirst,
    messageCreate,
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
  mocks.recipientFindFirst.mockResolvedValue(null);
  mocks.messageCreate.mockResolvedValue({ id: "message-1" });
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

  it("sets a manual end date at the end of the selected Riyadh day", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T12:00:00.000Z") });
    mocks.schoolFindUnique.mockResolvedValue({
      id: "school-1",
      plan_id: "monthly-plan",
      subscription_status: "expired",
      renewal_date: new Date("2026-09-19T23:59:59.999Z"),
      subscription_plan: { billing_interval: "MONTHLY" },
    });

    const response = await PUT(
      request({ action: "set_end_date", renewal_date: "2026-10-15" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.schoolUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        renewal_date: new Date("2026-10-15T20:59:59.999Z"),
        subscription_status: "active",
      }),
    }));
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "subscription_end_date_changed" }),
    });
  });

  it("rejects an impossible manual end date", async () => {
    const response = await PUT(
      request({ action: "set_end_date", renewal_date: "2026-02-30" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("immediately warns the school when a manual end date is within seven days", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T12:00:00.000Z") });
    mocks.schoolFindUnique.mockResolvedValue({
      id: "school-1",
      name: "روضة الاختبار",
      plan_id: null,
      subscription_status: "trial",
      renewal_date: new Date("2026-10-20T23:59:59.999Z"),
      subscription_plan: null,
    });

    const response = await PUT(
      request({ action: "set_end_date", renewal_date: "2026-09-21" }),
      { params: Promise.resolve({ schoolId: "school-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: "اشتراكك ينتهي قريبًا",
        template_key: "renewal_soon",
        target_type: "system",
        recipients: { create: { school_id: "school-1", delivered_at: new Date("2026-09-20T12:00:00.000Z") } },
      }),
    });
  });
});
