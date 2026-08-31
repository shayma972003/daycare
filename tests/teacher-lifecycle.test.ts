import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deviceDateInputValue } from "@/lib/device-date";
import { isTeacherOperational } from "@/lib/teacher-lifecycle";

const source = (path: string) => readFileSync(path, "utf8");

describe("teacher contact and lifecycle", () => {
  it("treats the contract end day as inclusive in the device calendar", () => {
    const teacher = { isActive: true, status: "ACTIVE", enrollmentEndDate: "2026-08-30" };
    expect(isTeacherOperational(teacher, new Date("2026-08-30T23:30:00Z"), "America/New_York")).toBe(true);
    expect(isTeacherOperational(teacher, new Date("2026-08-31T12:00:00Z"), "Asia/Riyadh")).toBe(false);
    expect(isTeacherOperational({ ...teacher, isActive: false }, new Date("2026-08-30T12:00:00Z"), "UTC")).toBe(false);
  });

  it("defaults the contract-end calendar date to the device zone without UTC drift", () => {
    const instant = new Date("2026-08-30T23:30:00.000Z");
    expect(deviceDateInputValue(instant, "Asia/Tokyo")).toBe("2026-08-31");
    expect(deviceDateInputValue(instant, "America/Los_Angeles")).toBe("2026-08-30");
    expect(source("src/app/(dashboard)/teachers/[id]/page.tsx"))
      .toContain("useState(() => deviceDateInputValue())");
  });

  it("has no operational teacher payment reminder route", () => {
    expect(source("src/lib/route-permissions.ts")).not.toContain('"/api/teachers/:id/reminder"');
    expect(source("src/app/(dashboard)/teachers/[id]/page.tsx")).not.toContain("handleSendReminder");
  });
});
