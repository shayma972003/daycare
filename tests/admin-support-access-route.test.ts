import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindUnique: vi.fn(),
  ticketFindFirst: vi.fn(),
  accessUpdateMany: vi.fn(),
  accessCreate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFindUnique },
    supportTicket: { findFirst: mocks.ticketFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "@/app/api/admin/support-access/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.schoolFindUnique.mockResolvedValue({ id: "school-1", name: "مدرسة النور" });
  mocks.ticketFindFirst.mockResolvedValue({ id: "ticket-1" });
  mocks.accessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.accessCreate.mockResolvedValue({ id: "access-1", expiresAt: new Date("2026-10-26T12:30:00Z") });
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    supportAccessSession: { updateMany: mocks.accessUpdateMany, create: mocks.accessCreate },
    adminActivityLog: { create: mocks.activityCreate },
  }));
});

describe("secure support access", () => {
  it("creates one time-limited read-only context for the selected tenant", async () => {
    const response = await POST(new Request("http://localhost/api/admin/support-access", {
      method: "POST",
      body: JSON.stringify({
        schoolId: "school-1",
        ticketId: "ticket-1",
        reason: "التحقق من تعطل تسجيل الدخول",
        durationMinutes: 30,
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.ticketFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1", schoolId: "school-1" },
    }));
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdByAdminId: "admin-1", revokedAt: null }),
    }));
    expect(mocks.accessCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ schoolId: "school-1", ticketId: "ticket-1", createdByAdminId: "admin-1" }),
    }));
  });

  it("requires an explicit support reason", async () => {
    const response = await POST(new Request("http://localhost/api/admin/support-access", {
      method: "POST",
      body: JSON.stringify({ schoolId: "school-1", reason: "قصير" }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a ticket that belongs to another tenant", async () => {
    mocks.ticketFindFirst.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/admin/support-access", {
      method: "POST",
      body: JSON.stringify({
        schoolId: "school-1",
        ticketId: "ticket-other-school",
        reason: "التحقق من مشكلة مرتبطة بالتذكرة",
      }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
