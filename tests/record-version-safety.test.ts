import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("record version write safety", () => {
  it.each([
    "src/app/api/students/[id]/route.ts",
    "src/app/api/teachers/[id]/route.ts",
    "src/app/api/classes/[id]/route.ts",
    "src/app/api/admin/schools/[id]/route.ts",
  ])("requires an expected revision and rejects a stale %s save", (path) => {
    const source = read(path);
    expect(source).toContain("expectedUpdatedAt: z.iso.datetime()");
    expect(source).toContain("updatedAt: new Date(");
    expect(source).toContain('code: "STALE_RECORD"');
  });

  it("sends the loaded revision from every profile editor", () => {
    for (const path of [
      "src/app/(dashboard)/students/[id]/page.tsx",
      "src/app/(dashboard)/teachers/[id]/page.tsx",
      "src/app/(dashboard)/classes/[id]/page.tsx",
      "src/app/admin/(protected)/schools/[id]/page.tsx",
    ]) {
      expect(read(path)).toContain("expectedUpdatedAt:");
    }
  });
});
