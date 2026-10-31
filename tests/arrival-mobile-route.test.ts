import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  recipients: vi.fn(),
  acknowledge: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.auth,
  mobileAuthResponse: () => null,
}));
vi.mock("@/lib/arrival-notifications", () => ({
  createGuardianArrivalNotice: mocks.create,
  arrivalMinutesFromDates: (expectedAt: Date, createdAt: Date) =>
    Math.max(0, Math.round((expectedAt.getTime() - createdAt.getTime()) / 60_000)),
  arrivalNoticeMessage: (senderName: string, minutes: number) =>
    minutes === 0
      ? `ولي الأمر ${senderName} وصل`
      : `سيصل ${senderName} خلال ${minutes} دقائق`,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    arrivalNoticeRecipient: { findMany: mocks.recipients, updateMany: mocks.acknowledge },
  },
}));

import { GET, PATCH, POST } from "@/app/api/mobile/v1/arrival/route";

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
      arrivalMinutes: 5,
    });
  });

  it("passes an arrived choice through without accepting arbitrary minutes", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { sub: "guardian-account-1", kind: "guardian" },
    });
    mocks.create.mockResolvedValue({
      created: true,
      noticeId: "arrival-now",
      message: "ولي الأمر سارة وصل",
      expectedAt: new Date("2026-09-29T09:00:00.000Z"),
      cooldownUntil: new Date("2026-09-29T09:05:00.000Z"),
      recipients: 1,
      pushQueued: 1,
    });

    const response = await POST(new Request("http://localhost/api/mobile/v1/arrival", {
      method: "POST",
      body: JSON.stringify({ minutes: 0 }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ arrivalMinutes: 0 }));
    await expect(response.json()).resolves.toMatchObject({
      message: "ولي الأمر سارة وصل",
      cooldownUntil: "2026-09-29T09:05:00.000Z",
    });

    const invalid = await POST(new Request("http://localhost/api/mobile/v1/arrival", {
      method: "POST",
      body: JSON.stringify({ minutes: 20 }),
    }));
    expect(invalid.status).toBe(422);
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
      where: { schoolId: "school-1", userId: "staff-1", readAt: null },
    }));
    expect((await response.json()).notices).toHaveLength(1);
    expect((await GET(new Request("http://localhost/api/mobile/v1/arrival")).then((result) => result.json())).notices[0])
      .toMatchObject({ message: "سيصل سارة خلال 5 دقائق" });
  });

  it("acknowledges only the signed-in staff account's own unread notice", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { sub: "staff-1", kind: "staff" },
    });
    mocks.acknowledge.mockResolvedValue({ count: 1 });

    const response = await PATCH(new Request("http://localhost/api/mobile/v1/arrival", {
      method: "PATCH",
      body: JSON.stringify({ noticeId: "arrival-1" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.acknowledge).toHaveBeenCalledWith({
      where: {
        noticeId: "arrival-1",
        schoolId: "school-1",
        userId: "staff-1",
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });
});
