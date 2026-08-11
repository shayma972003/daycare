import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rateLimit: {
      deleteMany: mocks.deleteMany,
      upsert: mocks.upsert,
    },
  },
}));

import {
  rateLimit,
  rateLimitResetResponse,
  rateLimitResponse,
  resetRateLimit,
} from "@/lib/rate-limit";

const SENSITIVE_KEY = "login:person@example.test:203.0.113.42";

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  mocks.upsert.mockReset().mockResolvedValue({
    count: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });
});

describe("database-backed rate limiter decisions", () => {
  it("returns an allowed decision below the limit", async () => {
    await expect(
      rateLimit({ key: SENSITIVE_KEY, limit: 2, windowMs: 60_000 })
    ).resolves.toEqual({ status: "allowed", remaining: 1, retryAfter: 0 });
  });

  it("returns a limited decision after the limit", async () => {
    mocks.upsert.mockResolvedValueOnce({
      count: 3,
      expiresAt: new Date(Date.now() + 45_000),
    });

    const result = await rateLimit({ key: SENSITIVE_KEY, limit: 2, windowMs: 60_000 });
    expect(result.status).toBe("limited");
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("fails closed without logging or returning the sensitive key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.deleteMany.mockRejectedValueOnce(new Error(`database failed for ${SENSITIVE_KEY}`));

    const result = await rateLimit({ key: SENSITIVE_KEY, limit: 2, windowMs: 60_000 });
    expect(result).toEqual({ status: "unavailable", remaining: 0, retryAfter: 10 });

    const response = rateLimitResponse(result)!;
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(await response.text()).not.toContain(SENSITIVE_KEY);
    expect(error.mock.calls.flat().join(" ")).not.toContain(SENSITIVE_KEY);
  });

  it("allows only one of two concurrent requests at a limit of one", async () => {
    let count = 0;
    mocks.upsert.mockImplementation(async () => ({
      count: ++count,
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const results = await Promise.all([
      rateLimit({ key: SENSITIVE_KEY, limit: 1, windowMs: 60_000 }),
      rateLimit({ key: SENSITIVE_KEY, limit: 1, windowMs: 60_000 }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["allowed", "limited"]);
  });
});

describe("rate-limit HTTP responses", () => {
  it("returns no response when the request is allowed", () => {
    expect(
      rateLimitResponse({ status: "allowed", remaining: 1, retryAfter: 0 })
    ).toBeNull();
  });

  it("returns 429 and Retry-After when the caller is limited", async () => {
    const response = rateLimitResponse({ status: "limited", remaining: 0, retryAfter: 37 })!;
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(await response.text()).not.toContain(SENSITIVE_KEY);
  });

  it("returns 503 and a short Retry-After when the store is unavailable", async () => {
    const response = rateLimitResponse({
      status: "unavailable",
      remaining: 0,
      retryAfter: 10,
    })!;
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(await response.text()).not.toContain(SENSITIVE_KEY);
  });
});

describe("rate-limit reset", () => {
  it("reports a successful reset", async () => {
    await expect(resetRateLimit(SENSITIVE_KEY)).resolves.toEqual({ status: "reset" });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { key: SENSITIVE_KEY } });
  });

  it("reports a failed reset without leaking the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.deleteMany.mockRejectedValueOnce(new Error(`database failed for ${SENSITIVE_KEY}`));
    await expect(resetRateLimit(SENSITIVE_KEY)).resolves.toEqual({ status: "unavailable" });
    expect(error.mock.calls.flat().join(" ")).not.toContain(SENSITIVE_KEY);
  });

  it("converts a failed login reset to a retryable 503", () => {
    const response = rateLimitResetResponse({ status: "unavailable" })!;
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(rateLimitResetResponse({ status: "reset" })).toBeNull();
  });
});
