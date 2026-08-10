import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENROLLMENT_MANAGE_PERMISSION,
  isPublicEnrollmentRoute,
} from "@/lib/enrollment-access";
import { isUngated, requirementFor } from "@/lib/route-permissions";

function source(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), "utf8");
}

describe("enrollment route boundary", () => {
  const publicRoutes = [
    ["/api/enrollment/verify-token/opaque-token-123456789", "GET"],
    ["/api/enrollment/verify-otp", "POST"],
    ["/api/enrollment/resend-otp", "POST"],
    ["/api/enrollment/submit", "POST"],
    ["/api/enrollment/upload", "POST"],
  ] as const;

  it.each(publicRoutes)("allows the parent route %s with %s", (pathname, method) => {
    expect(isPublicEnrollmentRoute(pathname, method)).toBe(true);
    expect(isUngated(pathname, method)).toBe(true);
  });

  it("does not make a public route available through a different method", () => {
    expect(isPublicEnrollmentRoute("/api/enrollment/verify-token/token-1234567890", "POST")).toBe(false);
    expect(isPublicEnrollmentRoute("/api/enrollment/submit", "GET")).toBe(false);
    expect(isUngated("/api/enrollment/submit", "GET")).toBe(false);
  });

  it.each([
    ["/api/enrollment/create-token", "POST"],
    ["/api/enrollment/submissions", "GET"],
    ["/api/enrollment/approve/9d35f9cc-7441-4d50-926f-8a582a0d61be", "POST"],
    ["/api/enrollment/reject/9d35f9cc-7441-4d50-926f-8a582a0d61be", "POST"],
  ] as const)("requires students.manage for %s %s", (pathname, method) => {
    expect(isUngated(pathname, method)).toBe(false);
    expect(requirementFor(pathname, method)).toBe(ENROLLMENT_MANAGE_PERMISSION);
  });

  it("removes the broad enrollment bypass from both proxy and permission prefixes", () => {
    const proxy = source("src/proxy.ts");
    const permissions = source("src/lib/route-permissions.ts");

    expect(proxy).not.toContain('"/api/enrollment",');
    expect(proxy).not.toContain("api/enrollment|");
    expect(permissions).not.toMatch(/UNGATED_PREFIXES\s*=\s*\[[\s\S]*?"\/api\/enrollment"/);
  });

  it("keeps every public enrollment handler rate limited and token-bound", () => {
    const handlers = [
      "src/app/api/enrollment/verify-token/[token]/route.ts",
      "src/app/api/enrollment/verify-otp/route.ts",
      "src/app/api/enrollment/resend-otp/route.ts",
      "src/app/api/enrollment/submit/route.ts",
      "src/app/api/enrollment/upload/route.ts",
    ];

    for (const handler of handlers) {
      const code = source(handler);
      expect(code).toContain("rateLimit");
      expect(code).toContain("token");
    }

    expect(source("src/app/api/enrollment/submit/route.ts")).toContain("rec.otp_verified");
    expect(source("src/app/api/enrollment/upload/route.ts")).toContain("record.otp_verified");
  });
});

describe("enrollment UI/API permission parity", () => {
  it("uses the same permission constant in every administrative handler", () => {
    const handlers = [
      "src/app/api/enrollment/create-token/route.ts",
      "src/app/api/enrollment/submissions/route.ts",
      "src/app/api/enrollment/approve/[submission_id]/route.ts",
      "src/app/api/enrollment/reject/[submission_id]/route.ts",
    ];

    for (const handler of handlers) {
      const code = source(handler);
      expect(code).toContain("requireSession()");
      expect(code).toContain("session.can(ENROLLMENT_MANAGE_PERMISSION)");
    }
  });

  it("gates enrollment management in both student and dashboard screens", () => {
    for (const screen of [
      "src/app/(dashboard)/students/page.tsx",
      "src/app/(dashboard)/dashboard/page.tsx",
    ]) {
      const code = source(screen);
      expect(code).toContain("ENROLLMENT_MANAGE_PERMISSION");
      expect(code).toContain("canManageEnrollment");
    }
  });
});
