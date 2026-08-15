import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ handler: vi.fn() }));

vi.mock("next-auth", () => ({ default: () => mocks.handler }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

function context(...nextauth: string[]) {
  return { params: Promise.resolve({ nextauth }) };
}

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

    const request = new NextRequest("http://localhost/api/auth/callback/credentials", {
      method: "POST",
    });
    const routeContext = context("callback", "credentials");
    const response = await POST(request, routeContext);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("RATE_LIMIT_UNAVAILABLE");
    expect(mocks.handler).toHaveBeenCalledWith(request, routeContext);
  });

  it("preserves an ordinary invalid-credentials response", async () => {
    mocks.handler.mockResolvedValueOnce(
      Response.json(
        { url: "http://localhost/api/auth/error?error=CredentialsSignin" },
        { status: 401 }
      )
    );

    const request = new NextRequest("http://localhost/api/auth/callback/credentials", {
      method: "POST",
    });
    const routeContext = context("callback", "credentials");
    const response = await POST(request, routeContext);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({
      url: "http://localhost/api/auth/error?error=CredentialsSignin",
    });
    expect(mocks.handler).toHaveBeenCalledWith(request, routeContext);
  });

  it("forwards the signout catch-all context without a server error", async () => {
    mocks.handler.mockResolvedValueOnce(Response.json({ url: "http://localhost/login" }));
    const request = new NextRequest("http://localhost/api/auth/signout", { method: "POST" });
    const routeContext = context("signout");

    const response = await POST(request, routeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.handler).toHaveBeenCalledWith(request, routeContext);
  });

  it.each(["session", "csrf"])(
    "forwards the %s catch-all context without a server error",
    async (action) => {
      mocks.handler.mockResolvedValueOnce(Response.json({}));
      const request = new NextRequest(`http://localhost/api/auth/${action}`);
      const routeContext = context(action);

      const response = await GET(request, routeContext);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(mocks.handler).toHaveBeenCalledWith(request, routeContext);
    }
  );
});
