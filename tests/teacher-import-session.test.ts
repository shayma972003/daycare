import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importConfirmationPaths } from "@/lib/import-session";

describe("teacher import confirmation session", () => {
  it("builds every request from the session passed at the event boundary", () => {
    expect(importConfirmationPaths("old-session")).toEqual({
      confirm: "/api/import/old-session/confirm",
      status: "/api/import/old-session",
    });
    expect(importConfirmationPaths("new-session")).toEqual({
      confirm: "/api/import/new-session/confirm",
      status: "/api/import/new-session",
    });
  });

  it("passes current state explicitly and has no auto-confirm effect closure", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/teachers/import/page.tsx"),
      "utf8"
    );
    expect(page).toContain("async function runConfirm(targetSessionId: string)");
    expect(page).toContain("await runConfirm(sessionId)");
    expect(page).not.toContain("confirmCalledRef");
    expect(page).not.toContain("useEffect");
  });
});
