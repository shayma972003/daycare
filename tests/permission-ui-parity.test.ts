import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requirementFor } from "@/lib/route-permissions";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function expectGate(path: string, permission: string) {
  expect(source(path)).toContain(`permission="${permission}"`);
}

describe("critical web action and API permission parity", () => {
  it.each([
    ["POST", "/api/students", "students.manage"],
    ["POST", "/api/import/upload", "students.manage"],
    ["POST", "/api/attendance/students/checkin", "attendance.students"],
    ["PUT", "/api/students/bulk", "students.manage"],
    ["PUT", "/api/students/opaque-student-id-123456789", "students.manage"],
    ["DELETE", "/api/students/opaque-student-id-123456789", "students.delete"],
    ["POST", "/api/teachers", "staff.manage"],
    ["POST", "/api/attendance/teachers/checkin", "attendance.staff"],
    ["PUT", "/api/teachers/opaque-teacher-id-123456789", "staff.manage"],
    ["DELETE", "/api/teachers/opaque-teacher-id-123456789", "staff.delete"],
    ["POST", "/api/classes", "classes.manage"],
    ["PUT", "/api/classes/opaque-class-id-123456789", "classes.manage"],
    ["DELETE", "/api/classes/opaque-class-id-123456789", "classes.archive"],
    ["POST", "/api/classes/opaque-class-id-123456789/add-students", "classes.assign"],
    ["POST", "/api/calendar", "schedule.manage"],
    ["PUT", "/api/calendar/opaque-event-id-123456789", "schedule.manage"],
    ["DELETE", "/api/calendar/opaque-event-id-123456789", "schedule.delete"],
  ])("maps %s %s to %s", (method, pathname, permission) => {
    expect(requirementFor(pathname, method)).toBe(permission);
  });

  it("gates the key student and teacher actions with those API permissions", () => {
    expectGate("src/app/(dashboard)/students/page.tsx", "students.manage");
    expectGate("src/app/(dashboard)/students/page.tsx", "attendance.students");
    expectGate("src/app/(dashboard)/students/[id]/page.tsx", "students.delete");
    expectGate("src/app/(dashboard)/students/[id]/page.tsx", "students.manage");
    expectGate("src/app/(dashboard)/teachers/page.tsx", "staff.manage");
    expectGate("src/app/(dashboard)/teachers/page.tsx", "attendance.staff");
    expectGate("src/app/(dashboard)/teachers/[id]/page.tsx", "staff.delete");
    expectGate("src/app/(dashboard)/teachers/[id]/page.tsx", "staff.manage");
  });

  it("gates class and calendar mutations with their exact API permissions", () => {
    expectGate("src/app/(dashboard)/classes/page.tsx", "classes.manage");
    expectGate("src/app/(dashboard)/classes/[id]/page.tsx", "classes.manage");
    expectGate("src/app/(dashboard)/classes/[id]/page.tsx", "classes.archive");
    expectGate("src/app/(dashboard)/classes/[id]/page.tsx", "classes.assign");
    expectGate("src/app/(dashboard)/calendar/page.tsx", "schedule.manage");
    expectGate("src/components/calendar/CalendarEventModal.tsx", "schedule.manage");
    expectGate("src/components/calendar/CalendarEventModal.tsx", "schedule.delete");
  });

  it("uses the shared gate in navigation and enrollment surfaces", () => {
    for (const path of [
      "src/components/layout/Sidebar.tsx",
      "src/components/layout/Topbar.tsx",
      "src/components/layout/CommandPalette.tsx",
      "src/app/(dashboard)/dashboard/page.tsx",
    ]) {
      expect(source(path)).toContain("PermissionGate");
    }
  });
});
