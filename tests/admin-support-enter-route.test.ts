import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  accessFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  signToken: vi.fn(),
  buildCookie: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportAccessSession: { findFirst: mocks.accessFindFirst },
    adminActivityLog: { create: mocks.activityCreate },
  },
}));
vi.mock("@/lib/support-view-token", () => ({
  signSupportViewToken: mocks.signToken,
  buildSupportViewCookie: mocks.buildCookie,
  clearSupportViewCookie: () => "support_view=; Max-Age=0",
}));

import { POST } from "@/app/api/admin/support-access/[id]/enter/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.accessFindFirst.mockResolvedValue({
    id: "access-1",
    schoolId: "school-1",
    ticketId: "ticket-1",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  });
  mocks.signToken.mockResolvedValue("signed-support-token");
  mocks.buildCookie.mockReturnValue("support_view=signed-support-token; HttpOnly; Path=/");
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
});

describe("temporary tenant support entry", () => {
  it("issues a short-lived support-only cookie and audits entry", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/support-access/access-1/enter", { method: "POST" }),
      { params: Promise.resolve({ id: "access-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/dashboard");
    expect(response.headers.get("set-cookie")).toContain("support_view=signed-support-token");
    expect(mocks.signToken).toHaveBeenCalledWith(expect.objectContaining({
      accessId: "access-1",
      adminId: "admin-1",
      schoolId: "school-1",
    }));
    expect(mocks.activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "support_tenant_view_entered", performed_by: "admin-1" }),
    }));
  });

  it("does not issue a cookie for an expired or revoked support session", async () => {
    mocks.accessFindFirst.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/admin/support-access/access-1/enter", { method: "POST" }),
      { params: Promise.resolve({ id: "access-1" }) },
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
});
