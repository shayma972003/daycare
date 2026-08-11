import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  twoFaFindFirst: vi.fn(),
  twoFaUpdate: vi.fn(),
  schoolUpdate: vi.fn(),
  schoolFindFirst: vi.fn(),
  resetTokenFindFirst: vi.fn(),
  resetTokenDeleteMany: vi.fn(),
  resetTokenCreate: vi.fn(),
  transaction: vi.fn(),
  bcryptCompare: vi.fn(),
  rateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  clientIp: vi.fn(),
  tooManyRequests: vi.fn(),
  sendEmail: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    twoFASession: {
      findFirst: mocks.twoFaFindFirst,
      update: mocks.twoFaUpdate,
    },
    school: {
      update: mocks.schoolUpdate,
      findFirst: mocks.schoolFindFirst,
    },
    passwordResetToken: {
      findFirst: mocks.resetTokenFindFirst,
      deleteMany: mocks.resetTokenDeleteMany,
      create: mocks.resetTokenCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: mocks.bcryptCompare, hash: vi.fn() },
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  resetRateLimit: mocks.resetRateLimit,
  clientIp: mocks.clientIp,
}));

vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/datetime", () => ({
  astDayStart: () => new Date("2026-08-11T00:00:00.000Z"),
}));

import { authOptions } from "@/lib/auth";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

type Authorize = (
  credentials: Record<string, string> | undefined,
  request: { body: unknown; query: unknown; headers: unknown; method: string }
) => Promise<unknown>;

const authorize = (
  authOptions.providers[0] as unknown as { options: { authorize: Authorize } }
).options.authorize;

function user(acceptedAt: Date | null) {
  return {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    password: "bcrypt-hash",
    role: "admin",
    schoolId: "school-1",
    disabledAt: null,
    acceptedAt,
    school: {
      id: "school-1",
      name: "School One",
      twoFaEnabled: false,
      subscription_status: "active",
      renewal_date: null,
    },
  };
}

const request = { body: {}, query: {}, headers: {}, method: "POST" };

beforeEach(() => {
  for (const value of Object.values(mocks)) value.mockReset();
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 4, retryAfter: 0 });
  mocks.resetRateLimit.mockResolvedValue({ status: "reset" });
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.bcryptCompare.mockResolvedValue(true);
  mocks.schoolUpdate.mockResolvedValue({});
  mocks.logAction.mockResolvedValue(undefined);
  mocks.transaction.mockResolvedValue([]);
});

describe("school administrator activation guard", () => {
  it("fails closed with a distinct signal when the web-login limiter store is unavailable", async () => {
    mocks.rateLimit.mockResolvedValueOnce({
      status: "unavailable",
      remaining: 0,
      retryAfter: 10,
    });

    await expect(
      authorize({ email: "owner@example.com", password: "ValidPass1!" }, request)
    ).rejects.toThrow("RATE_LIMIT_UNAVAILABLE");
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("does not allow a pending invited account to sign in even with a matching hash", async () => {
    mocks.userFindUnique.mockResolvedValue(user(null));

    const result = await authorize(
      { email: "owner@example.com", password: "known-password" },
      request
    );

    expect(result).toBeNull();
    expect(mocks.bcryptCompare).toHaveBeenCalled();
    expect(mocks.resetRateLimit).not.toHaveBeenCalled();
    expect(mocks.schoolUpdate).not.toHaveBeenCalled();
  });

  it("does not issue a password-reset code for a pending invitation", async () => {
    mocks.userFindUnique.mockResolvedValue(user(null));

    const response = await forgotPassword(
      new Request("http://localhost/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: "owner@example.com" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not let password reset activate a pending invitation", async () => {
    mocks.userFindUnique.mockResolvedValue(user(null));

    const response = await resetPassword(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: "owner@example.com",
          otp: "123456",
          newPassword: "valid-password",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.resetTokenFindFirst).not.toHaveBeenCalled();
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
  });

  it("allows the account after invitation acceptance", async () => {
    mocks.userFindUnique.mockResolvedValue(user(new Date()));

    const result = await authorize(
      { email: "owner@example.com", password: "chosen-password" },
      request
    );

    expect(result).toEqual({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
      schoolId: "school-1",
      schoolName: "School One",
      role: "admin",
    });
    expect(mocks.resetRateLimit).toHaveBeenCalledWith("login:owner@example.com");
  });

  it("does not create a web session when the successful-login reset fails", async () => {
    mocks.userFindUnique.mockResolvedValue(user(new Date()));
    mocks.resetRateLimit.mockResolvedValueOnce({ status: "unavailable" });

    await expect(
      authorize(
        { email: "owner@example.com", password: "chosen-password" },
        request
      )
    ).rejects.toThrow("RATE_LIMIT_UNAVAILABLE");
  });

  it("rejects a stale 2FA bypass session for an account that is not activated", async () => {
    mocks.twoFaFindFirst.mockResolvedValue({
      id: "twofa-1",
      userId: "user-1",
    });
    mocks.userFindUnique.mockResolvedValue(user(null));

    const result = await authorize({ twofa_bypass_token: "bypass" }, request);

    expect(result).toBeNull();
    expect(mocks.twoFaUpdate).not.toHaveBeenCalled();
  });
});
