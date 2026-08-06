import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract guards for the mobile attendance routes.
 *
 * `/api/mobile/*` is excluded from `route-permissions.ts` — those routes prove
 * the caller themselves through `requireMobileAuth`. That makes the exclusion
 * safe only for as long as every route actually calls it, and nothing in the
 * type system says it must: a new file that forgets is valid TypeScript, builds
 * clean, and is open to anyone holding any token.
 *
 * These read the source rather than run the handlers, because the failures they
 * guard against are *absences* — a missing guard, a missing tenant filter — and
 * an absence is what a unit test with a mocked Prisma is least likely to catch.
 */
const ROOT = join(process.cwd(), "src/app/api/mobile/v1");

function source(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

const ROUTES = [
  ["attendance/route.ts", "staff"],
  ["attendance/today/route.ts", "staff"],
  ["invoices/route.ts", "guardian"],
  ["care-reports/create/route.ts", "staff"],
] as const;

describe("mobile route contracts", () => {
  it("every route proves the caller before doing anything", () => {
    for (const [file] of ROUTES) {
      const code = source(file);
      expect(code, `${file} does not call requireMobileAuth`).toContain("requireMobileAuth");
      // The catch must translate the guard's error, or a 401 surfaces as a 500.
      expect(code, `${file} does not handle the auth error`).toContain("mobileAuthResponse");
    }
  });

  it("declares which kind of account each route is for", () => {
    for (const [file, kind] of ROUTES) {
      expect(source(file), `${file} is not restricted to ${kind}`).toContain(`kind: "${kind}"`);
    }
  });

  it("gates the staff attendance routes on the attendance permission", () => {
    // A teacher's token carries her permissions; without this a member of staff
    // with no attendance right could still check children in.
    for (const file of [
      "attendance/route.ts",
      "attendance/today/route.ts",
      "care-reports/create/route.ts",
    ]) {
      expect(source(file), `${file} has no permission check`).toContain(
        'permission: "attendance.students"'
      );
    }
  });

  it("scopes staff queries by school", () => {
    for (const file of [
      "attendance/route.ts",
      "attendance/today/route.ts",
      "care-reports/create/route.ts",
    ]) {
      const code = source(file);
      expect(code, `${file} never reads schoolId from the claims`).toContain(
        "context.claims.schoolId"
      );
      expect(code, `${file} does not filter by schoolId`).toMatch(/schoolId[,:]/);
    }
  });

  it("scopes the guardian route through her own children", () => {
    const code = source("invoices/route.ts");
    // A tenant filter alone would hand a parent the whole school's billing.
    expect(code).toContain("guardianChildIds");
    expect(code).toContain("in: allowedIds");
  });

  it("uses the shared definition of today, not its own arithmetic", () => {
    // Two definitions of "today" is how the app and the dashboard start
    // disagreeing about which day a check-in belongs to.
    expect(source("attendance/route.ts")).toContain("astDateOnly");
    expect(source("attendance/today/route.ts")).toContain("astDayStart");
    for (const [file] of ROUTES) {
      expect(source(file), `${file} does its own offset arithmetic`).not.toMatch(
        /3 \* 60 \* 60 \* 1000/
      );
    }
  });

  it("stamps avatars, which an app cannot fetch with a bearer token", () => {
    expect(source("attendance/today/route.ts")).toContain("stampFileUrl");
  });

  it("refuses new personal data on an anonymised record", () => {
    // A child whose data was destroyed under the retention policy must not gain
    // more of it. See docs/DATA_LIFECYCLE.md.
    const code = source("care-reports/create/route.ts");
    expect(code).toContain("anonymizedAt");
  });

  it("checks a posted photo URL belongs to this school", () => {
    // The upload route hands back a key inside the school's prefix, but nothing
    // stops a caller posting a different one.
    const code = source("care-reports/create/route.ts");
    expect(code).toContain("schoolIdFromKey");
  });

  it("does not ship invoice PDFs in the list", () => {
    // `pdfUrl` is a base64 data URI of the whole document; a year of them would
    // be megabytes over a phone connection.
    expect(source("invoices/route.ts")).not.toContain("pdfUrl: true");
  });
});
