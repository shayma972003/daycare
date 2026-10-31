import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deviceToken: { findFirst: mocks.findFirst },
    pushNotification: { create: mocks.create },
  },
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { enqueuePushToDevice } from "@/lib/push";

const payload = {
  title: "اختبار إشعارات طفولة تيك",
  body: "تم إرسال إشعار اختباري من لوحة الدعم الفني.",
  data: { screen: "notifications", kind: "support_test" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ id: "push-1" });
});

describe("tenant-scoped support test push", () => {
  it("queues exactly one active device inside the requested school", async () => {
    mocks.findFirst.mockResolvedValue({ id: "device-1" });

    const queued = await enqueuePushToDevice(
      { schoolId: "school-1", deviceTokenId: "device-1" },
      payload
    );

    expect(queued).toBe(true);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "device-1",
        schoolId: "school-1",
        failedAt: null,
      }),
      select: { id: true },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: "school-1",
        deviceTokenId: "device-1",
        data: payload.data,
      }),
    });
  });

  it("does not queue an unavailable or cross-tenant device", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const queued = await enqueuePushToDevice(
      { schoolId: "school-1", deviceTokenId: "device-from-another-school" },
      payload
    );

    expect(queued).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
