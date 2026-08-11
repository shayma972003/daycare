import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  accountUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  bcryptCompare: vi.fn(),
  rateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  clientIp: vi.fn(),
  tooManyRequests: vi.fn(),
  claimsForSubject: vi.fn(),
  issueTokenPair: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    guardianAccount: {
      findUnique: mocks.accountFindUnique,
      update: mocks.accountUpdate,
    },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.bcryptCompare } }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  resetRateLimit: mocks.resetRateLimit,
  clientIp: mocks.clientIp,
  tooManyRequests: mocks.tooManyRequests,
}));
vi.mock("@/lib/mobile-auth", () => ({
  claimsForSubject: mocks.claimsForSubject,
  issueTokenPair: mocks.issueTokenPair,
}));

import { POST as mobileLogin } from "@/app/api/mobile/v1/auth/login/route";

function loginRequest() {
  return new Request("http://localhost/api/mobile/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "guardian",
      email: "guardian@example.test",
      password: "Guardian-password-1!",
    }),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.accountFindUnique.mockResolvedValue({
    id: "guardian-account-1",
    passwordHash: "bcrypt-hash",
    disabledAt: null,
    acceptedAt: new Date("2026-08-11T12:00:00.000Z"),
    schoolId: "school-1",
    guardian: { name: "Guardian One" },
    school: { name: "School One" },
  });
  mocks.bcryptCompare.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue({ ok: true, remaining: 4, retryAfter: 0 });
  mocks.resetRateLimit.mockResolvedValue(undefined);
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.claimsForSubject.mockResolvedValue({
    sub: "guardian-account-1",
    kind: "guardian",
    schoolId: "school-1",
  });
  mocks.issueTokenPair.mockResolvedValue({ accessToken: "access", refreshToken: "refresh" });
  mocks.accountUpdate.mockResolvedValue({ id: "guardian-account-1" });
});

describe("guardian mobile login after invitation acceptance", () => {
  it("issues a guardian session for an accepted account with its chosen password", async () => {
    const response = await mobileLogin(loginRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.bcryptCompare).toHaveBeenCalledWith("Guardian-password-1!", "bcrypt-hash");
    expect(mocks.claimsForSubject).toHaveBeenCalledWith("guardian", "guardian-account-1");
    expect(body.account).toMatchObject({
      id: "guardian-account-1",
      kind: "guardian",
      schoolId: "school-1",
    });
  });

  it("still refuses a pending account before invitation acceptance", async () => {
    mocks.accountFindUnique.mockResolvedValueOnce({
      id: "guardian-account-1",
      passwordHash: null,
      disabledAt: null,
      acceptedAt: null,
      schoolId: "school-1",
      guardian: { name: "Guardian One" },
      school: { name: "School One" },
    });
    mocks.bcryptCompare.mockResolvedValueOnce(false);
    const response = await mobileLogin(loginRequest());
    expect(response.status).toBe(401);
    expect(mocks.issueTokenPair).not.toHaveBeenCalled();
  });
});
