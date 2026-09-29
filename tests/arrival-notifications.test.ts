import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  account: vi.fn(),
  claim: vi.fn(),
  currentAccount: vi.fn(),
  settings: vi.fn(),
  createNotice: vi.fn(),
  updateNotice: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    arrivalNotice: { update: mocks.updateNotice },
  },
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.push }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { createGuardianArrivalNotice } from "@/lib/arrival-notifications";

const tx = {
  guardianAccount: {
    findFirst: mocks.account,
    updateMany: mocks.claim,
    findUnique: mocks.currentAccount,
  },
  arrivalRecipientSetting: { findMany: mocks.settings },
  arrivalNotice: { create: mocks.createNotice },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.account.mockResolvedValue({
    lastArrivalNoticeAt: null,
    guardian: { name: "سارة أحمد" },
  });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.settings.mockResolvedValue([{ userId: "staff-1" }, { userId: "staff-2" }]);
  mocks.createNotice.mockResolvedValue({
    id: "arrival-1",
    senderName: "سارة أحمد",
    expectedAt: new Date("2026-09-29T09:05:00.000Z"),
    recipients: [
      { schoolId: "school-1", userId: "staff-1" },
      { schoolId: "school-1", userId: "staff-2" },
    ],
  });
  mocks.push.mockResolvedValue(1);
  mocks.updateNotice.mockResolvedValue({});
});

describe("guardian arrival notifications", () => {
  it("stores one child-free notice and queues the exact parent-name message for selected staff", async () => {
    const result = await createGuardianArrivalNotice({
      schoolId: "school-1",
      guardianAccountId: "guardian-account-1",
      now: new Date("2026-09-29T09:00:00.000Z"),
    });

    expect(result).toMatchObject({
      created: true,
      noticeId: "arrival-1",
      message: "سيصل سارة أحمد خلال 5 دقائق",
      recipients: 2,
      pushQueued: 2,
    });
    expect(mocks.createNotice).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schoolId: "school-1",
        guardianAccountId: "guardian-account-1",
        senderName: "سارة أحمد",
        recipients: {
          create: [{ userId: "staff-1" }, { userId: "staff-2" }],
        },
      }),
    }));
    const stored = mocks.createNotice.mock.calls[0][0].data;
    expect(stored).not.toHaveProperty("studentId");
    expect(stored).not.toHaveProperty("childId");
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push.mock.calls.map((call) => call[0].userId)).toEqual(["staff-1", "staff-2"]);
    expect(mocks.push.mock.calls[0][1]).toMatchObject({
      title: "إشعار وصول",
      body: "سيصل سارة أحمد خلال 5 دقائق",
    });
  });

  it("rejects a repeat inside five minutes without creating or pushing another notice", async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    mocks.currentAccount.mockResolvedValue({
      lastArrivalNoticeAt: new Date("2026-09-29T09:00:00.000Z"),
    });

    const result = await createGuardianArrivalNotice({
      schoolId: "school-1",
      guardianAccountId: "guardian-account-1",
      now: new Date("2026-09-29T09:02:00.000Z"),
    });

    expect(result).toEqual({
      created: false,
      reason: "COOLDOWN",
      retryAfterSeconds: 180,
    });
    expect(mocks.createNotice).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("records the press even when the director has not selected a recipient", async () => {
    mocks.settings.mockResolvedValue([]);
    mocks.createNotice.mockResolvedValue({
      id: "arrival-empty",
      senderName: "سارة أحمد",
      expectedAt: new Date("2026-09-29T09:05:00.000Z"),
      recipients: [],
    });

    const result = await createGuardianArrivalNotice({
      schoolId: "school-1",
      guardianAccountId: "guardian-account-1",
      now: new Date("2026-09-29T09:00:00.000Z"),
    });

    expect(result).toMatchObject({ created: true, recipients: 0, pushQueued: 0 });
    expect(mocks.createNotice.mock.calls[0][0].data).not.toHaveProperty("recipients");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
