import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moneyInputValue, sanitizeIntegerInput, sanitizeMoneyInput } from "@/lib/numeric-input";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("class capacity", () => {
  it("accepts only digits for seat counts, including Arabic numerals", () => {
    expect(sanitizeIntegerInput("١٢ مقعدًا")).toBe("12");
    expect(sanitizeIntegerInput("25.5")).toBe("255");
  });

  it("connects capacity to class creation, cards, editing, and dashboard alerts", () => {
    const route = source("src/app/api/classes/route.ts");
    const list = source("src/app/(dashboard)/classes/page.tsx");
    const profile = source("src/app/(dashboard)/classes/[id]/page.tsx");
    const tasks = source("src/app/api/dashboard/tasks/route.ts");

    expect(route).toContain("capacity: z.number().int().min(0).max(500).optional()");
    expect(route).toContain("capacityState(room.students.length, room.capacity)");
    expect(list).toContain('t("classes.capacityOccupancy"');
    expect(profile).toContain('capacity: form.capacity === "" ? null : Number(form.capacity)');
    expect(tasks).toContain('key: "lowClassCapacity"');
    expect(tasks).toContain("if (remaining >= 5) return []");
  });
});
describe("fee text inputs", () => {
  it("keeps numeric text editable and normalizes Arabic digits", () => {
    expect(sanitizeMoneyInput("١٢٣٫٤٥ ريال")).toBe("123.45");
    expect(sanitizeMoneyInput("12abc.345")).toBe("12.34");
    expect(moneyInputValue("", null)).toBeNull();
    expect(moneyInputValue("75.50", 0)).toBe(75.5);
  });

  it("uses text fields without number spinners for all fee settings", () => {
    const settings = source("src/app/(dashboard)/settings/page.tsx");
    const feeSection = settings.slice(settings.indexOf("{/* ── Fee Settings"), settings.indexOf("{/* ── Academic stages"));
    expect(feeSection).not.toContain('type="number"');
    expect(feeSection.match(/inputMode="decimal"/g)).toHaveLength(5);
    expect(feeSection.match(/sanitizeMoneyInput/g)).toHaveLength(5);
  });
});

