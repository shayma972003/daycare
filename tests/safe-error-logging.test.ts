import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { logSafeError, safeErrorDetails } from "@/lib/safe-logger";

describe("safe error logging", () => {
  it("keeps only the error class and a bounded code", () => {
    const error = Object.assign(new Error("contains a database URL and PII"), {
      code: "P2002",
      meta: { target: "secret@example.test" },
    });
    expect(safeErrorDetails(error)).toEqual({ name: "Error", code: "P2002" });
  });

  it("does not log the raw error object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("sensitive message");
    logSafeError("test-scope", error);
    expect(spy).toHaveBeenCalledWith("[test-scope] failed", { name: "Error" });
    expect(spy.mock.calls.flat()).not.toContain(error);
    spy.mockRestore();
  });

  it("uses the safe logger at backend error boundaries", () => {
    const files = [
      "src/lib/auth.ts",
      "src/lib/care-report-digest.ts",
      "src/lib/anonymization.ts",
      "src/lib/export-audit.ts",
      "src/lib/trash-cleanup.ts",
      "src/lib/r2.ts",
      "src/app/api/care-reports/route.ts",
      "src/app/api/statistics/dashboard/route.ts",
      "src/app/api/expenses/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/admin/data-retention/run/route.ts",
      "src/app/api/admin/data-retention/route.ts",
      "src/app/api/admin/cron/purge-trash/route.ts",
      "src/app/api/students/route.ts",
    ];
    for (const file of files) {
      const code = readFileSync(join(process.cwd(), file), "utf8");
      expect(code, file).toContain("logSafeError(");
      expect(code, file).not.toMatch(/console\.error\([^\n]*(?:error|err)\b/);
    }
  });
});
