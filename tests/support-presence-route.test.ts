import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  accessFindFirst: vi.fn(),
  accessUpdate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportAccessSession: { findFirst: mocks.accessFindFirst, update: mocks.accessUpdate },
    adminActivityLog: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/support-view-token", () => ({ clearSupportViewCookie: () => "support_view=; Max-Age=0; Path=/" }));

import { DELETE, GET, POST } from "@/app/api/support-presence/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({
    user: { schoolId: "school-1" },
    isSupportAccess: true,
    supportAccessId: "access-1",
  });
  mocks.accessFindFirst.mockResolvedValue({
    id: "access-1",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    ticketId: "ticket-1",
    createdByAdminId: "admin-1",
  });
  mocks.accessUpdate.mockResolvedValue({ id: "access-1" });
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.transaction.mockResolvedValue([]);
});

describe("tenant support presence", () => {
  it("shows the active support notice to the school account", async () => {
    mocks.requireSession.mockResolvedValue({ user: { schoolId: "school-1" }, isSupportAccess: false });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ active: true, isSupportViewer: false });
  });

  it("records every dashboard path viewed by support", async () => {
    const response = await POST(new Request("http://localhost/api/support-presence", {
      method: "POST",
      body: JSON.stringify({ pathname: "/calendar" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "support_tenant_page_viewed",
        performed_by: "admin-1",
        metadata: expect.objectContaining({ pathname: "/calendar", accessSessionId: "access-1" }),
      }),
    }));
  });

  it("refuses page-audit calls from normal school users", async () => {
    mocks.requireSession.mockResolvedValue({ user: { schoolId: "school-1" }, isSupportAccess: false });
    const response = await POST(new Request("http://localhost/api/support-presence", {
      method: "POST",
      body: JSON.stringify({ pathname: "/calendar" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("revokes the support session and clears its cookie on exit", async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.accessUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "access-1" },
      data: { revokedAt: expect.any(Date) },
    }));
  });
});
