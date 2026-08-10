import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { astDateInputValue } from "@/lib/datetime";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Riyadh local today", () => {
  it("keeps 00:00 through 02:59 Riyadh on the new local date", () => {
    expect(astDateInputValue(new Date("2026-08-04T21:00:00.000Z"))).toBe("2026-08-05");
    expect(astDateInputValue(new Date("2026-08-04T22:30:00.000Z"))).toBe("2026-08-05");
    expect(astDateInputValue(new Date("2026-08-04T23:59:59.999Z"))).toBe("2026-08-05");
  });

  it("rolls correctly at the end of a month and a year", () => {
    expect(astDateInputValue(new Date("2026-01-31T21:00:00.000Z"))).toBe("2026-02-01");
    expect(astDateInputValue(new Date("2026-12-31T21:00:00.000Z"))).toBe("2027-01-01");
  });

  it("produces the same initial value from a serialized SSR instant on the client", () => {
    const serverInstant = new Date("2026-12-31T22:30:00.000Z");
    const serverValue = astDateInputValue(serverInstant);
    const clientValue = astDateInputValue(new Date(serverInstant.toISOString()));
    expect(clientValue).toBe(serverValue);
  });

  it.each([
    "src/app/(dashboard)/care/page.tsx",
    "src/components/attendance/AttendanceDonut.tsx",
    "src/app/(dashboard)/teachers/new/page.tsx",
    "src/components/admin/AdminInvoiceModal.tsx",
  ])("uses the shared Riyadh helper in %s", (path) => {
    expect(source(path)).toContain("astDateInputValue");
    expect(source(path)).not.toContain("new Date().toISOString().slice(0, 10)");
  });
});
