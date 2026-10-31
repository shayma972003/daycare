import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  accessFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  refreshStorageUsage: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportAccessSession: { findFirst: mocks.accessFindFirst },
    adminActivityLog: { create: mocks.activityCreate },
  },
}));
vi.mock("@/lib/storage-usage", () => ({ refreshStorageUsage: mocks.refreshStorageUsage }));

import { POST } from "@/app/api/admin/support-access/[id]/actions/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/support-access/access-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.accessFindFirst.mockResolvedValue({
    id: "access-1",
    schoolId: "school-1",
    ticketId: "ticket-1",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    revokedAt: null,
  });
  mocks.activityCreate.mockResolvedValue({ id: "log-1" });
  mocks.refreshStorageUsage.mockResolvedValue({ totalBytes: 1234 });
});

describe("controlled support tools", () => {
  it("requires explicit confirmation and a detailed reason", async () => {
    const response = await POST(request({
      action: "REFRESH_STORAGE_USAGE",
      reason: "فحص مساحة التخزين بعد بلاغ العميل",
      confirmed: false,
    }), { params: Promise.resolve({ id: "access-1" }) });

    expect(response.status).toBe(422);
    expect(mocks.accessFindFirst).not.toHaveBeenCalled();
    expect(mocks.refreshStorageUsage).not.toHaveBeenCalled();
  });

  it("runs only the allowlisted tool and records intent and completion", async () => {
    const response = await POST(request({
      action: "REFRESH_STORAGE_USAGE",
      reason: "فحص مساحة التخزين بعد بلاغ العميل",
      confirmed: true,
    }), { params: Promise.resolve({ id: "access-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "REFRESH_STORAGE_USAGE", result: { totalBytes: 1234 } });
    expect(mocks.refreshStorageUsage).toHaveBeenCalledWith("school-1");
    expect(mocks.activityCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ action: "support_tool_started", metadata: expect.objectContaining({ reason: "فحص مساحة التخزين بعد بلاغ العميل" }) }),
    }));
    expect(mocks.activityCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ action: "support_tool_completed", metadata: expect.objectContaining({ totalBytes: 1234 }) }),
    }));
  });

  it("rejects tools outside the explicit allowlist", async () => {
    const response = await POST(request({
      action: "UPDATE_CHILD",
      reason: "محاولة تعديل غير مسموحة من الدعم",
      confirmed: true,
    }), { params: Promise.resolve({ id: "access-1" }) });

    expect(response.status).toBe(422);
    expect(mocks.accessFindFirst).not.toHaveBeenCalled();
    expect(mocks.refreshStorageUsage).not.toHaveBeenCalled();
  });

  it("blocks the tool when the support session has expired", async () => {
    mocks.accessFindFirst.mockResolvedValue({
      id: "access-1",
      schoolId: "school-1",
      ticketId: null,
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      revokedAt: null,
    });

    const response = await POST(request({
      action: "REFRESH_STORAGE_USAGE",
      reason: "فحص مساحة التخزين بعد بلاغ العميل",
      confirmed: true,
    }), { params: Promise.resolve({ id: "access-1" }) });

    expect(response.status).toBe(410);
    expect(mocks.refreshStorageUsage).not.toHaveBeenCalled();
  });
});
