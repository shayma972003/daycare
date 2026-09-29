import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  recipients: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.auth,
  mobileAuthResponse: () => null,
}));
vi.mock("@/lib/arrival-notifications", () => ({
  createGuardianArrivalNotice: mocks.create,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    arrivalNoticeRecipient: { findMany: mocks.recipients },
  },
}));

import { GET, POST } from "@/app/api/mobile/v1/arrival/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mobile arrival route", () => {
  it("accepts a body-free guardian press and derives the account from auth", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { sub: "guardian-account-1", kind: "guardian" },
    });
    mocks.create.mockResolvedValue({
      created: true,
      noticeId: "arrival-1",
      message: "سيصل سارة خلال 5 دقائق",
      expectedAt: new Date("2026-09-29T09:05:00.000Z"),
      recipients: 1,
      pushQueued: 1,
    });

    const response = await POST(new Request("http://localhost/api/mobile/v1/arrival", { method: "POST" }));
    expect(response.status).toBe(201);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), { kind: "guardian" });
    expect(mocks.create).toHaveBeenCalledWith({
      schoolId: "school-1",
      guardianAccountId: "guardian-account-1",
    });
  });

  it("returns Retry-After when the five-minute window is still active", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { sub: "guardian-account-1", kind: "guardian" },
    });
    mocks.create.mockResolvedValue({
      created: false,
      reason: "COOLDOWN",
      retryAfterSeconds: 121,
    });

    const response = await POST(new Request("http://localhost/api/mobile/v1/arrival", { method: "POST" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("121");
    expect(await response.json()).toMatchObject({ code: "ARRIVAL_COOLDOWN", retryAfterSeconds: 121 });
  });

  it("returns only the signed-in staff account's snapshotted notices", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { sub: "staff-1", kind: "staff" },
    });
    mocks.recipients.mockResolvedValue([
      {
        readAt: null,
        notice: {
          id: "arrival-1",
          senderName: "سارة",
          expectedAt: new Date("2026-09-29T09:05:00.000Z"),
          createdAt: new Date("2026-09-29T09:00:00.000Z"),
        },
      },
    ]);

    const response = await GET(new Request("http://localhost/api/mobile/v1/arrival"));
    expect(response.status).toBe(200);
    expect(mocks.recipients).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", userId: "staff-1" },
    }));
    expect((await response.json()).notices).toHaveLength(1);
  });
});
