import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  schoolFindMany: vi.fn(),
  messageCreate: vi.fn(),
  activityCreate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminSessionFromRequest: mocks.verifyAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: mocks.schoolFindMany },
    adminMessage: { create: mocks.messageCreate },
    adminActivityLog: { create: mocks.activityCreate },
  },
}));

import { POST } from "@/app/api/admin/messages/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAdmin.mockResolvedValue({ adminId: "admin-1" });
});

describe("admin message sending", () => {
  it("does not create a misleading sent message when no schools match", async () => {
    mocks.schoolFindMany.mockResolvedValue([]);

    const response = await POST(request({
      subject: "إشعار صيانة مجدولة",
      body: "سيكون هناك توقف مؤقت للصيانة.",
      target_type: "all",
    }));

    expect(response.status).toBe(422);
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
