import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOneTimeCode } from "@/lib/one-time-code";

const mocks = vi.hoisted(() => ({
  guardianFindUnique: vi.fn(),
  guardianUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  schoolFindFirst: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenDelete: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenClaimDeleteMany: vi.fn(),
  tokenCreate: vi.fn(),
  tokenUpdate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  refreshDeleteMany: vi.fn(),
  transaction: vi.fn(),
  sendEmail: vi.fn(),
  rateLimit: vi.fn(),
  clientIp: vi.fn(),
  tooManyRequests: vi.fn(),
  bcryptHash: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    guardianAccount: {
      findUnique: mocks.guardianFindUnique,
      update: mocks.guardianUpdate,
    },
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    school: { findFirst: mocks.schoolFindFirst },
    passwordResetToken: {
      findFirst: mocks.tokenFindFirst,
      delete: mocks.tokenDelete,
      deleteMany: mocks.tokenDeleteMany,
      create: mocks.tokenCreate,
      update: mocks.tokenUpdate,
      updateMany: mocks.tokenUpdateMany,
    },
    refreshToken: { deleteMany: mocks.refreshDeleteMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: mocks.clientIp,
}));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.bcryptHash } }));

import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

const account = {
  id: "guardian-account-1",
  email: "guardian@example.test",
  acceptedAt: new Date("2026-08-01T00:00:00.000Z"),
  disabledAt: null,
};

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.guardianFindUnique.mockResolvedValue(account);
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 4, retryAfter: 0 });
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.tokenDeleteMany.mockResolvedValue({ count: 1 });
  mocks.tokenClaimDeleteMany.mockResolvedValue({ count: 1 });
  mocks.tokenCreate.mockResolvedValue({ id: "reset-1" });
  mocks.guardianUpdate.mockResolvedValue({ id: account.id });
  mocks.refreshDeleteMany.mockResolvedValue({ count: 2 });
  mocks.bcryptHash.mockResolvedValue("new-bcrypt-hash");
  mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (input: unknown) => {
    if (Array.isArray(input)) return Promise.all(input);
    const callback = input as (tx: unknown) => unknown;
    return callback({
      guardianAccount: { update: mocks.guardianUpdate },
      user: { update: mocks.userUpdate },
      passwordResetToken: {
        deleteMany: vi.fn((args) =>
          "id" in (args.where ?? {})
            ? mocks.tokenClaimDeleteMany(args)
            : mocks.tokenDeleteMany(args)
        ),
        updateMany: mocks.tokenUpdateMany,
      },
      refreshToken: { deleteMany: mocks.refreshDeleteMany },
      twoFASession: { deleteMany: vi.fn() },
    });
  });
});

describe("guardian password recovery", () => {
  it("returns 503 without resolving an account when the limiter store is unavailable", async () => {
    mocks.rateLimit.mockResolvedValueOnce({
      status: "unavailable",
      remaining: 0,
      retryAfter: 10,
    });

    const response = await forgotPassword(
      request("/api/auth/forgot-password", {
        email: "guardian@example.test",
        kind: "guardian",
      })
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mocks.guardianFindUnique).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("guardian@example.test");
  });

  it("issues the reset token for the guardian subject and emails the account address", async () => {
    const response = await forgotPassword(
      request("/api/auth/forgot-password", {
        email: "GUARDIAN@EXAMPLE.TEST",
        kind: "guardian",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.guardianFindUnique).toHaveBeenCalledWith({
      where: { email: "guardian@example.test" },
      select: { id: true, email: true, acceptedAt: true, disabledAt: true },
    });
    expect(mocks.tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guardianAccountId: "guardian-account-1",
        tokenHash: expect.stringMatching(/^hmac-v1:[a-f0-9]{64}$/),
      }),
    });
    expect(mocks.tokenCreate.mock.calls[0]?.[0].data).not.toHaveProperty("userId");
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "guardian@example.test",
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it("does not issue a reset token for a pending or disabled guardian", async () => {
    mocks.guardianFindUnique.mockResolvedValueOnce({ ...account, acceptedAt: null });
    const response = await forgotPassword(
      request("/api/auth/forgot-password", {
        email: account.email,
        kind: "guardian",
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns the same public success for an unknown guardian email", async () => {
    mocks.guardianFindUnique.mockResolvedValueOnce(null);
    const response = await forgotPassword(
      request("/api/auth/forgot-password", {
        email: "unknown@example.test",
        kind: "guardian",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("burns the reset token and returns a real failure when email delivery fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: "provider detail" });
    const response = await forgotPassword(
      request("/api/auth/forgot-password", {
        email: account.email,
        kind: "guardian",
      })
    );
    expect(response.status).toBe(502);
    expect(mocks.tokenDeleteMany).toHaveBeenLastCalledWith({
      where: { guardianAccountId: "guardian-account-1" },
    });
    expect(JSON.stringify(await response.json())).not.toContain("provider detail");
  });

  it("sets the guardian password and invalidates reset and refresh tokens atomically", async () => {
    const otp = "123456";
    mocks.tokenFindFirst.mockResolvedValueOnce({
      id: "reset-1",
      guardianAccountId: account.id,
      userId: null,
      tokenHash: hashOneTimeCode(otp, "password-reset"),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });

    const response = await resetPassword(
      request("/api/auth/reset-password", {
        identifier: account.email,
        kind: "guardian",
        otp,
        newPassword: "Guardian-password-1!",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.guardianUpdate).toHaveBeenCalledWith({
      where: { id: account.id, acceptedAt: { not: null }, disabledAt: null },
      data: { passwordHash: "new-bcrypt-hash" },
    });
    expect(mocks.tokenDeleteMany).toHaveBeenCalledWith({
      where: { guardianAccountId: account.id },
    });
    expect(mocks.refreshDeleteMany).toHaveBeenCalledWith({
      where: { guardianAccountId: account.id },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing staff recovery contract when kind is omitted", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "owner@example.test",
      acceptedAt: new Date(),
      disabledAt: null,
    });
    const response = await forgotPassword(
      request("/api/auth/forgot-password", { identifier: "owner@example.test" })
    );
    expect(response.status).toBe(200);
    expect(mocks.userFindUnique).toHaveBeenCalled();
    expect(mocks.tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    });
  });
});
