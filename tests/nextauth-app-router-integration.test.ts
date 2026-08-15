import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CredentialsProvider from "next-auth/providers/credentials";
import { AuthHandler } from "../node_modules/next-auth/core/index.js";
import type { NextAuthOptions } from "next-auth";

const TEST_SECRET = "test-only-nextauth-secret-that-is-long-enough";
const authorize = vi.fn();

const options: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize,
    }),
  ],
  secret: TEST_SECRET,
  session: { strategy: "jwt" },
};

function csrf() {
  const token = "test-csrf-token";
  const hash = createHash("sha256").update(`${token}${TEST_SECRET}`).digest("hex");
  return {
    token,
    cookies: { "next-auth.csrf-token": `${token}|${hash}` },
  };
}

beforeAll(() => {
  process.env.NEXTAUTH_URL = "http://localhost";
});

beforeEach(() => {
  authorize.mockReset();
});

describe("installed NextAuth authentication behavior", () => {
  it("returns 401 rather than an internal error for invalid credentials", async () => {
    authorize.mockResolvedValueOnce(null);
    const { token, cookies } = csrf();

    const response = await AuthHandler({
      options,
      req: {
        action: "callback",
        providerId: "credentials",
        method: "POST",
        headers: { host: "localhost" },
        cookies,
        query: {},
        body: {
          csrfToken: token,
          email: "wrong@example.com",
          password: "wrong-password",
        },
      },
    });

    expect(response.status).toBe(401);
    expect(response.redirect).toContain("CredentialsSignin");
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("preserves the limiter-store signal for the route's generic 503 mapping", async () => {
    authorize.mockRejectedValueOnce(new Error("RATE_LIMIT_UNAVAILABLE"));
    const { token, cookies } = csrf();

    const response = await AuthHandler({
      options,
      req: {
        action: "callback",
        providerId: "credentials",
        method: "POST",
        headers: { host: "localhost" },
        cookies,
        query: {},
        body: { csrfToken: token, email: "user@example.com", password: "password" },
      },
    });

    expect(response.status).toBe(401);
    expect(response.redirect).toContain("RATE_LIMIT_UNAVAILABLE");
  });

  it("processes a CSRF-protected signout without an internal error", async () => {
    const { token, cookies } = csrf();
    const response = await AuthHandler({
      options,
      req: {
        action: "signout",
        method: "POST",
        headers: { host: "localhost" },
        cookies,
        query: {},
        body: { csrfToken: token, callbackUrl: "http://localhost/login" },
      },
    });

    expect(response.status ?? 200).toBe(200);
    expect(response.redirect).toBe("http://localhost/login");
  });

  it("serves session and csrf actions without an internal error", async () => {
    const session = await AuthHandler({
      options,
      req: {
        action: "session",
        method: "GET",
        headers: { host: "localhost" },
        cookies: {},
        query: {},
      },
    });
    const csrfResponse = await AuthHandler({
      options,
      req: {
        action: "csrf",
        method: "GET",
        headers: { host: "localhost" },
        cookies: {},
        query: {},
      },
    });

    expect(session.status ?? 200).toBe(200);
    expect(csrfResponse.status ?? 200).toBe(200);
    expect(csrfResponse.body).toMatchObject({ csrfToken: expect.any(String) });
  });
});
