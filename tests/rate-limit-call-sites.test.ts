import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RATE_LIMITED_CALL_SITES = [
  "src/lib/auth.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/reset-password/route.ts",
  "src/app/api/auth/verify-2fa/route.ts",
  "src/app/api/auth/resend-2fa-otp/route.ts",
  "src/app/api/activate/[token]/route.ts",
  "src/app/api/admin/auth/login/route.ts",
  "src/app/api/admin/settings/password/route.ts",
  "src/app/api/admin/schools/[id]/invite/route.ts",
  "src/app/api/mobile/v1/auth/login/route.ts",
  "src/app/api/enrollment/create-token/route.ts",
  "src/app/api/enrollment/verify-token/[token]/route.ts",
  "src/app/api/enrollment/verify-otp/route.ts",
  "src/app/api/enrollment/resend-otp/route.ts",
  "src/app/api/enrollment/submit/route.ts",
  "src/app/api/enrollment/upload/route.ts",
  "src/app/api/staff-accounts/[id]/invite/route.ts",
  "src/app/api/guardian-accounts/route.ts",
  "src/app/api/guardian-accounts/[id]/invite/route.ts",
  "src/app/api/students/[id]/reminder/route.ts",
  "src/app/api/reminders/route.ts",
  "src/app/api/activities/[id]/send/route.ts",
  "src/app/api/mobile/v1/auth/refresh/route.ts",
] as const;

describe("sensitive rate-limit call sites", () => {
  it.each(RATE_LIMITED_CALL_SITES)("uses the centralized decision response in %s", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toContain("rateLimit(");
    expect(source).toContain("rateLimitResponse(");
    // Check the result of rateLimit itself, not unrelated domain results such
    // as `rotateRefreshToken(...).ok` in the mobile refresh route.
    for (const match of source.matchAll(/const\s+(\w+)\s*=\s*await\s+rateLimit\s*\(/g)) {
      expect(source).not.toContain(`if (!${match[1]}.ok)`);
    }
    expect(source).not.toMatch(/tooManyRequests\s*\(/);
    expect(source).not.toMatch(/key\s*:\s*`[^`]*\$\{(?:token|password|otp|otp_code)\}/i);
  });

  it("maps a NextAuth limiter-store outage to an HTTP 503 response", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/auth/[...nextauth]/route.ts"),
      "utf8"
    );
    expect(source).toContain("RATE_LIMIT_UNAVAILABLE");
    expect(source).toContain("rateLimitResponse(");
    expect(source).toContain("response.status !== 401");
  });

  it("never logs the full limiter key", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/rate-limit.ts"), "utf8");
    expect(source).not.toMatch(/console\.(?:error|warn|log)\([^\n]*\bkey\b/);
    expect(source).not.toContain("allowing request");
  });
});
