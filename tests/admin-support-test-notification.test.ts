import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  enqueue: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/push", () => ({ enqueuePushToDevice: mocks.enqueue }));
vi.mock("@/lib/prisma", () => ({ prisma: { adminActivityLog: { create: mocks.audit } } }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "127.0.0.1",
  rateLimit: mocks.rateLimit,
  rateLimitResponse: () => null,
}));

import { POST } from "@/app/api/admin/schools/[id]/notifications/test/route";

function request(deviceId = "device-1") {
  return new Request("http://localhost/api/admin/schools/school-1/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.enqueue.mockResolvedValue(true);
  mocks.audit.mockResolvedValue({});
});

describe("super-admin support test notification", () => {
  it("queues one tenant-scoped device test and records the admin action", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "school-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      { schoolId: "school-1", deviceTokenId: "device-1" },
      expect.objectContaining({
        title: "اختبار إشعارات طفولة تيك",
        data: { screen: "notifications", kind: "support_test" },
      })
    );
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      school_id: "school-1",
      action: "support_test_notification_queued",
      performed_by: "admin-1",
    }) });
  });

  it("rejects an unavailable or cross-tenant device without writing an audit row", async () => {
    mocks.enqueue.mockResolvedValue(false);

    const response = await POST(request("other-device"), { params: Promise.resolve({ id: "school-1" }) });

    expect(response.status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("requires a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await POST(request(), { params: Promise.resolve({ id: "school-1" }) });

    expect(response.status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
