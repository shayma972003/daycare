import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    twoFASession: { findUnique: mocks.findUnique },
  },
}));
vi.mock("@/lib/notifications", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: () => "203.0.113.42",
}));

import { POST as verifyTwoFactor } from "@/app/api/auth/verify-2fa/route";
import { POST as resendTwoFactor } from "@/app/api/auth/resend-2fa-otp/route";

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.rateLimit.mockReset().mockResolvedValue({
    status: "unavailable",
    remaining: 0,
    retryAfter: 10,
  });
});

function jsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("2FA rate-limit store failures", () => {
  it.each([
    [
      "verification",
      verifyTwoFactor,
      "/api/auth/verify-2fa",
      { twoFaSessionId: "session-1", otp_code: "123456" },
    ],
    [
      "resend",
      resendTwoFactor,
      "/api/auth/resend-2fa-otp",
      { twoFaSessionId: "session-1" },
    ],
  ] as const)("returns 503 before storage access for %s", async (_name, handler, path, body) => {
    const response = await handler(jsonRequest(path, body));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("203.0.113.42");
  });
});
