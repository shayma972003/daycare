import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSchoolAdminInvite: vi.fn(),
  redeemSchoolAdminInvite: vi.fn(),
  findInvite: vi.fn(),
  redeemInvite: vi.fn(),
  rateLimit: vi.fn(),
  clientIp: vi.fn(),
  tooManyRequests: vi.fn(),
}));

vi.mock("@/lib/school-admin-invitations", () => ({
  findSchoolAdminInvite: mocks.findSchoolAdminInvite,
  redeemSchoolAdminInvite: mocks.redeemSchoolAdminInvite,
}));

vi.mock("@/lib/invitations", () => ({
  findInvite: mocks.findInvite,
  redeemInvite: mocks.redeemInvite,
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: mocks.clientIp,
}));

import { GET, POST } from "@/app/api/activate/[token]/route";

const TOKEN = "B".repeat(32);
const subject = {
  kind: "school_admin" as const,
  name: "Owner",
  email: "owner@example.com",
  schoolName: "School One",
};

function context(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  for (const value of Object.values(mocks)) value.mockReset();
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 9, retryAfter: 0 });
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.tooManyRequests.mockImplementation((retryAfter: number) =>
    Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  );
  mocks.findSchoolAdminInvite.mockResolvedValue(subject);
  mocks.redeemSchoolAdminInvite.mockResolvedValue(subject);
  mocks.findInvite.mockResolvedValue(null);
  mocks.redeemInvite.mockResolvedValue(null);
});

describe("public school administrator invitation routes", () => {
  it("rate-limits the read-only validity check", async () => {
    const response = await GET(
      new Request(`http://localhost/api/activate/${TOKEN}`),
      context()
    );

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "activate-check:127.0.0.1",
      limit: 30,
      windowMs: 15 * 60 * 1000,
    });
  });

  it("uses the same public error for missing, expired, used, or revoked invitations", async () => {
    mocks.findSchoolAdminInvite.mockResolvedValue(null);
    mocks.findInvite.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/activate/${TOKEN}`),
      context()
    );
    const result = await response.json();

    expect(response.status).toBe(404);
    expect(Object.keys(result)).toEqual(["error"]);
  });

  it("sets the first password without returning token, hash, password, or account data", async () => {
    const response = await POST(
      new Request(`http://localhost/api/activate/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "valid-password" }),
      }),
      context()
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.redeemSchoolAdminInvite).toHaveBeenCalledWith(
      TOKEN,
      "valid-password"
    );
    expect(result).toEqual({ kind: "school_admin", email: "owner@example.com" });
    expect(JSON.stringify(result)).not.toMatch(/token|hash|password/i);
  });

  it("does not query invitation storage when the public rate limit is exceeded", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ status: "limited", remaining: 0, retryAfter: 90 });

    const response = await POST(
      new Request(`http://localhost/api/activate/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "valid-password" }),
      }),
      context()
    );

    expect(response.status).toBe(429);
    expect(mocks.findSchoolAdminInvite).not.toHaveBeenCalled();
    expect(mocks.redeemSchoolAdminInvite).not.toHaveBeenCalled();
  });
});
