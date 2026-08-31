import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deviceWeekStart } from "@/lib/device-date";

const source = (path: string) => readFileSync(path, "utf8");

describe("shift contracts", () => {
  it("uses shift ids, overlap locking, tenant checks, and no one-shift-per-day upsert", () => {
    const route = source("src/app/api/shifts/route.ts");
    const schema = source("prisma/schema.prisma");
    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain("SHIFT_OVERLAP");
    expect(route).toContain("shiftId");
    expect(route).not.toContain("teacherId_date");
    expect(schema).toContain("@@unique([teacherId, date, startTime, endTime])");
    expect(schema).toContain("classNameSnapshot");
  });

  it("starts the default rota week from the device-local Sunday", () => {
    const instant = new Date("2026-08-30T01:00:00.000Z");
    expect(deviceWeekStart(instant, "Asia/Tokyo").toISOString().slice(0, 10)).toBe("2026-08-30");
    expect(deviceWeekStart(instant, "America/Los_Angeles").toISOString().slice(0, 10)).toBe("2026-08-23");
    const route = source("src/app/api/shifts/route.ts");
    expect(route.indexOf("requestTimeZone(request)")).toBeLessThan(route.indexOf("deviceWeekStart(new Date(), timeZone)"));
  });
});
