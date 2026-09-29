import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  update: vi.fn(),
  activityCreate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminSessionFromRequest: mocks.verifyAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automatedAlertRule: { update: mocks.update },
    adminActivityLog: { create: mocks.activityCreate },
  },
}));

import { PUT } from "@/app/api/admin/alert-rules/[id]/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/alert-rules/rule-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function updateRule(body: unknown) {
  return PUT(request(body), { params: Promise.resolve({ id: "rule-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAdmin.mockResolvedValue({ adminId: "admin-1" });
});

describe("admin alert rule update", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.verifyAdmin.mockResolvedValue(null);

    const response = await updateRule({ threshold_days: 3 });

    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([-1, 3651, 1.5])("rejects invalid threshold %s", async (threshold) => {
    const response = await updateRule({ threshold_days: threshold });

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("updates a valid rule and records the change", async () => {
    const body = {
      threshold_days: 7,
      message_subject: "تنبيه محدث",
      message_template: "قالب محدث",
      is_active: false,
    };
    const rule = { id: "rule-1", ...body };
    mocks.update.mockResolvedValue(rule);

    const response = await updateRule(body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rule);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: body,
    });
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        action: "alert_rule_updated",
        metadata: { id: "rule-1", changes: body },
        performed_by: "super_admin",
      },
    });
  });
});
