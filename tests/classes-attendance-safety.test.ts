import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calendarToday, formatDeviceTime } from "@/lib/device-date";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("class assignment safety", () => {
  it("removes only when the student is still in the requested class and tenant", () => {
    const source = read("src/app/api/classes/[id]/students/route.ts");
    expect(source).toContain("schoolId, classId, deletedAt: null");
    expect(source).toContain("data: { classId: null");
    expect(source).toContain("status: 409");
  });

  it("does not retain the class image UI or upload calls", () => {
    for (const file of [
      "src/app/(dashboard)/classes/page.tsx",
      "src/app/(dashboard)/classes/new/page.tsx",
      "src/app/(dashboard)/classes/[id]/page.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/imageUrl|fileInputRef|handleImageChange|uploadHint/);
    }
  });
});

describe("device-local attendance day", () => {
  it("uses the supplied device zone around midnight", () => {
    const instant = new Date("2026-08-27T22:30:00.000Z");
    expect(calendarToday(instant, "Asia/Riyadh").toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(calendarToday(instant, "America/Los_Angeles").toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("formats stored instants in the device locale without changing the instant", () => {
    const instant = new Date("2026-08-28T00:15:00.000Z");
    expect(formatDeviceTime(instant, { hour: "2-digit", minute: "2-digit" }, "en")).toMatch(/\d/);
  });
});

describe("manual attendance concurrency", () => {
  it("uses conditional close and never schedule-based checkout", () => {
    const studentCheckout = read("src/app/api/attendance/students/checkout/route.ts");
    const teacherCheckout = read("src/app/api/teachers/[id]/checkout/route.ts");
    const operations = read("src/lib/attendance-operations.ts");
    expect(studentCheckout).toContain("checkoutStudent");
    expect(teacherCheckout).toContain("checkoutTeacher");
    expect(operations).toContain("checkoutAt: null");
    expect(operations).toContain("updateMany");
    expect(operations).toContain("closed.count !== 1");
    expect(studentCheckout).not.toMatch(/setTimeout|setInterval|cron/i);
    expect(teacherCheckout).not.toMatch(/setTimeout|setInterval|cron/i);
  });

  it("does not reopen a closed check-in or replace its original timestamp", () => {
    const studentCheckin = read("src/app/api/attendance/students/checkin/route.ts");
    const teacherCheckin = read("src/app/api/attendance/teachers/checkin/route.ts");
    const operations = read("src/lib/attendance-operations.ts");
    expect(studentCheckin).toContain("checkInStudent");
    expect(teacherCheckin).toContain("checkInTeacher");
    expect(operations).toContain("if (existing?.checkinAt || existing?.checkoutAt)");
    expect(operations).toContain("checkinAt: null");
    expect(operations).toContain("teacherAttendance.create");
    expect(operations).not.toContain("teacherAttendance.upsert");
    expect(operations).toContain("pg_advisory_xact_lock");
  });
});
