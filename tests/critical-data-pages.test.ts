import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const students = source("src/app/(dashboard)/students/page.tsx");
const teachers = source("src/app/(dashboard)/teachers/page.tsx");
const classes = source("src/app/(dashboard)/classes/page.tsx");
const dashboard = source("src/app/(dashboard)/dashboard/page.tsx");

describe("critical data page request contracts", () => {
  it.each([
    ["students", students],
    ["teachers", teachers],
  ])("debounces and cancels replaced %s searches", (_name, page) => {
    expect(page).toContain("setTimeout(() =>");
    expect(page).toContain("clearTimeout(timer)");
    expect(page).toContain("ticket.cancel()");
    expect(page).toContain("signal: ticket.signal");
  });

  it("does not couple attendance to student or teacher search dependencies", () => {
    expect(students).toMatch(
      /loadStudentAttendance\(ticket\)[\s\S]*?\}, \[attendanceRefresh, attendanceRequests, canManageAttendance, t\]\);/
    );
    expect(teachers).toMatch(
      /loadTeacherAttendance\(ticket\)[\s\S]*?\}, \[attendanceRefresh, attendanceRequests, canManageAttendance, t\]\);/
    );
    expect(students.match(/\/api\/attendance\/students\/today/g)).toHaveLength(1);
    expect(teachers.match(/\/api\/attendance\/teachers\/today/g)).toHaveLength(1);
  });

  it.each([
    ["students", students, "onRetry={refreshStudents}"],
    ["teachers", teachers, "onRetry={refreshTeachers}"],
    ["classes", classes, "onRetry={refreshClasses}"],
    ["dashboard activities", dashboard, "onRetry={retryActivities}"],
    ["dashboard logs", dashboard, "onRetry={retryLogs}"],
  ])("renders an explicit Retry path for %s", (_name, page, retryBinding) => {
    expect(page).toContain(retryBinding);
    expect(page).toContain('collectionView(');
  });

  it("uses item-level results where available and conservative count-only outcomes otherwise", () => {
    expect(students).toContain("exactBulkOutcome(ids, results.map((result) => result.status === \"fulfilled\"))");
    expect(students).toContain("countedBulkOutcome(ids, response.data.updated)");
    expect(teachers).toContain("countedBulkOutcome(ids, response.data.processed)");
    expect(students).toContain("setSelected(new Set(outcome.remainingSelection))");
    expect(teachers).toContain("setSelected(new Set(outcome.remainingSelection))");
  });
});
