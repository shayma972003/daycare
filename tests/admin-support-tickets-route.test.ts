import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  ticketCreate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFindUnique },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "@/app/api/admin/support-tickets/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.schoolFindUnique.mockResolvedValue({ id: "school-1", name: "مدرسة النور" });
  mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
  mocks.ticketCreate.mockResolvedValue({ id: "ticket-1", reference: "SUP-TEST" });
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    supportTicket: { create: mocks.ticketCreate },
    adminActivityLog: { create: mocks.activityCreate },
  }));
});

describe("support tickets", () => {
  it("creates a tenant-scoped ticket and records a metadata-only audit event", async () => {
    const response = await POST(new Request("http://localhost/api/admin/support-tickets", {
      method: "POST",
      body: JSON.stringify({
        schoolId: "school-1",
        requesterUserId: "user-1",
        title: "مشكلة تسجيل الدخول",
        description: "لا تستطيع المديرة فتح الحساب",
        priority: "HIGH",
      }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "ticket-1", reference: "SUP-TEST" });
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1", schoolId: "school-1" },
    }));
    expect(mocks.ticketCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ schoolId: "school-1", requesterUserId: "user-1", createdByAdminId: "admin-1" }),
    }));
    const auditPayload = mocks.activityCreate.mock.calls[0][0].data;
    expect(auditPayload.metadata).not.toHaveProperty("description");
    expect(JSON.stringify(auditPayload)).not.toContain("لا تستطيع المديرة");
  });

  it("rejects a requester account from a different tenant", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/admin/support-tickets", {
      method: "POST",
      body: JSON.stringify({
        schoolId: "school-1",
        requesterUserId: "user-other-school",
        title: "مشكلة في الحساب",
        description: "تعذر الدخول إلى الحساب الإداري",
      }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/admin/support-tickets", {
      method: "POST",
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(401);
    expect(mocks.schoolFindUnique).not.toHaveBeenCalled();
  });
});
