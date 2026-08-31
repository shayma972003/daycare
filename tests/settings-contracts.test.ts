import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("settings contracts", () => {
  it("keeps contact email separate from the login credential and sends partial settings updates", () => {
    const route = source("src/app/api/settings/route.ts");
    const page = source("src/app/(dashboard)/settings/page.tsx");
    expect(route).toContain("loginEmail: session.user.email");
    expect(route).not.toContain("prisma.user.update");
    expect(route).toContain('session.can("settings.manage")');
    expect(page).toContain("sectionPayload");
    expect(page).not.toContain("handleSaveSettings");
  });
});
