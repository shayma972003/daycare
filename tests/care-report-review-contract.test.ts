import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("care report review privacy contract", () => {
  it("keeps guardian reads and the digest limited to approved reports", () => {
    for (const file of [
      "src/app/api/mobile/v1/care-reports/route.ts",
      "src/app/api/portal/me/route.ts",
      "src/lib/care-report-digest.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain('reviewStatus: "APPROVED"');
    }
  });

  it("backfills historical reports as approved before making the column required", () => {
    const migration = readFileSync(
      "prisma/migrations/20260917120000_care_report_review_workflow/migration.sql",
      "utf8"
    );
    expect(migration.indexOf("UPDATE \"CareReport\"")).toBeLessThan(
      migration.indexOf("ALTER COLUMN \"reviewStatus\" SET NOT NULL")
    );
    expect(migration).toContain("SET \"reviewStatus\" = 'APPROVED'");
  });
});
