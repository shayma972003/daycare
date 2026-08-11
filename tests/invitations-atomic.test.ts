import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const userFindUnique = vi.fn();
  const userUpdateMany = vi.fn();
  const guardianFindUnique = vi.fn();
  const guardianUpdateMany = vi.fn();
  const twoFaDeleteMany = vi.fn();
  const refreshDeleteMany = vi.fn();
  const resetDeleteMany = vi.fn();
  const transaction = vi.fn();
  const bcryptHash = vi.fn();
  const tx = {
    user: { findUnique: userFindUnique, updateMany: userUpdateMany },
    guardianAccount: {
      findUnique: guardianFindUnique,
      updateMany: guardianUpdateMany,
    },
    twoFASession: { deleteMany: twoFaDeleteMany },
    refreshToken: { deleteMany: refreshDeleteMany },
    passwordResetToken: { deleteMany: resetDeleteMany },
  };
  return {
    userFindUnique,
    userUpdateMany,
    guardianFindUnique,
    guardianUpdateMany,
    twoFaDeleteMany,
    refreshDeleteMany,
    resetDeleteMany,
    transaction,
    bcryptHash,
    tx,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.bcryptHash } }));

import { hashInviteToken, redeemInvite } from "@/lib/invitations";

const TOKEN = "S".repeat(32);
const TOKEN_HASH = hashInviteToken(TOKEN);
const NOW = new Date("2026-08-11T12:00:00.000Z");
const ACCEPTED_AT = new Date("2026-08-01T12:00:00.000Z");

function staff(overrides: Record<string, unknown> = {}) {
  return {
    id: "staff-1",
    name: "Staff One",
    email: "staff@example.test",
    inviteTokenHash: TOKEN_HASH,
    inviteExpiresAt: new Date("2026-08-12T12:00:00.000Z"),
    acceptedAt: null,
    disabledAt: null,
    school: { name: "School One" },
    ...overrides,
  };
}

function guardian(overrides: Record<string, unknown> = {}) {
  return {
    id: "guardian-account-1",
    email: "guardian@example.test",
    inviteTokenHash: TOKEN_HASH,
    inviteExpiresAt: new Date("2026-08-12T12:00:00.000Z"),
    acceptedAt: ACCEPTED_AT,
    disabledAt: null,
    guardian: { name: "Guardian One" },
    school: { name: "School One" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const value of Object.values(mocks)) {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  }
  mocks.userFindUnique.mockResolvedValue(staff());
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.guardianFindUnique.mockResolvedValue(null);
  mocks.guardianUpdateMany.mockResolvedValue({ count: 1 });
  mocks.twoFaDeleteMany.mockResolvedValue({ count: 0 });
  mocks.refreshDeleteMany.mockResolvedValue({ count: 0 });
  mocks.resetDeleteMany.mockResolvedValue({ count: 0 });
  mocks.bcryptHash.mockResolvedValue("bcrypt-password-hash");
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("atomic staff invitation redemption", () => {
  it("claims with id and token CAS, sets the password, and invalidates all old sessions", async () => {
    const result = await redeemInvite(TOKEN, "Chosen-password-1!");

    expect(result).toEqual({
      kind: "staff",
      id: "staff-1",
      name: "Staff One",
      email: "staff@example.test",
      schoolName: "School One",
      alreadyAccepted: false,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "staff-1",
        inviteTokenHash: TOKEN_HASH,
        inviteExpiresAt: { gt: NOW },
        disabledAt: null,
      },
      data: {
        password: "bcrypt-password-hash",
        acceptedAt: NOW,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    expect(mocks.twoFaDeleteMany).toHaveBeenCalledWith({ where: { userId: "staff-1" } });
    expect(mocks.refreshDeleteMany).toHaveBeenCalledWith({ where: { userId: "staff-1" } });
    expect(mocks.resetDeleteMany).toHaveBeenCalledWith({ where: { userId: "staff-1" } });
  });

  it("rejects an expired invitation before the CAS write", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(
      staff({ inviteExpiresAt: new Date("2026-08-10T12:00:00.000Z") })
    );
    await expect(redeemInvite(TOKEN, "Chosen-password-1!")).resolves.toBeNull();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("allows exactly one of two concurrent CAS claims", async () => {
    let claims = 0;
    mocks.userUpdateMany.mockImplementation(async () => {
      claims += 1;
      return { count: claims === 1 ? 1 : 0 };
    });

    const results = await Promise.all([
      redeemInvite(TOKEN, "Chosen-password-1!"),
      redeemInvite(TOKEN, "Chosen-password-2!"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(mocks.twoFaDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("propagates a downstream failure so Prisma rolls back the password claim", async () => {
    mocks.refreshDeleteMany.mockRejectedValueOnce(new Error("session cleanup failed"));
    await expect(redeemInvite(TOKEN, "Chosen-password-1!")).rejects.toThrow(
      "session cleanup failed"
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.resetDeleteMany).not.toHaveBeenCalled();
  });
});

describe("guardian invitation compatibility", () => {
  it("keeps an existing acceptedAt and atomically clears the guardian token", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.guardianFindUnique.mockResolvedValueOnce(guardian());

    const result = await redeemInvite(TOKEN, "Guardian-password-1!");

    expect(result).toEqual({
      kind: "guardian",
      id: "guardian-account-1",
      name: "Guardian One",
      email: "guardian@example.test",
      schoolName: "School One",
      alreadyAccepted: true,
    });
    expect(mocks.guardianUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "guardian-account-1",
        inviteTokenHash: TOKEN_HASH,
        inviteExpiresAt: { gt: NOW },
        disabledAt: null,
      },
      data: {
        passwordHash: "bcrypt-password-hash",
        acceptedAt: ACCEPTED_AT,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    expect(mocks.refreshDeleteMany).toHaveBeenCalledWith({
      where: { guardianAccountId: "guardian-account-1" },
    });
    expect(mocks.resetDeleteMany).toHaveBeenCalledWith({
      where: { guardianAccountId: "guardian-account-1" },
    });
    expect(mocks.twoFaDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects an expired guardian invitation before the CAS write", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.guardianFindUnique.mockResolvedValueOnce(
      guardian({
        acceptedAt: null,
        inviteExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
      })
    );

    await expect(redeemInvite(TOKEN, "Guardian-password-1!")).resolves.toBeNull();
    expect(mocks.guardianUpdateMany).not.toHaveBeenCalled();
  });

  it("allows exactly one of two concurrent guardian invitation claims", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.guardianFindUnique.mockResolvedValue(guardian({ acceptedAt: null }));
    let claims = 0;
    mocks.guardianUpdateMany.mockImplementation(async () => ({
      count: ++claims === 1 ? 1 : 0,
    }));

    const results = await Promise.all([
      redeemInvite(TOKEN, "Guardian-password-1!"),
      redeemInvite(TOKEN, "Guardian-password-2!"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(mocks.refreshDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.resetDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("rolls back guardian acceptance when session invalidation fails", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.guardianFindUnique.mockResolvedValueOnce(guardian({ acceptedAt: null }));
    mocks.refreshDeleteMany.mockRejectedValueOnce(new Error("session cleanup failed"));

    await expect(redeemInvite(TOKEN, "Guardian-password-1!")).rejects.toThrow(
      "session cleanup failed"
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.resetDeleteMany).not.toHaveBeenCalled();
  });
});
