import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handler: vi.fn() }));

vi.mock("next-auth", () => ({ default: () => mocks.handler }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/auth/[...nextauth]/route";

beforeEach(() => {
  mocks.handler.mockReset();
});

describe("web-login rate-limit outage response", () => {
  it("maps the internal limiter signal to 503 with Retry-After", async () => {
    mocks.handler.mockResolvedValueOnce(
      Response.json(
        { url: "http://localhost/api/auth/error?error=RATE_LIMIT_UNAVAILABLE" },
        { status: 401 }
      )
    );

    const response = await POST(
      new Request("http://localhost/api/auth/callback/credentials", { method: "POST" })
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(await response.text()).not.toContain("RATE_LIMIT_UNAVAILABLE");
  });

  it("preserves an ordinary invalid-credentials response", async () => {
    mocks.handler.mockResolvedValueOnce(
      Response.json(
        { url: "http://localhost/api/auth/error?error=CredentialsSignin" },
        { status: 401 }
      )
    );

    const response = await POST(
      new Request("http://localhost/api/auth/callback/credentials", { method: "POST" })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      url: "http://localhost/api/auth/error?error=CredentialsSignin",
    });
  });
});
