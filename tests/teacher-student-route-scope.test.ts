import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("teacher child scope coverage", () => {
  it("loads active class assignments into both browser and mobile auth contexts", () => {
    for (const file of ["src/lib/session.ts", "src/lib/mobile-guard.ts"]) {
      const code = source(file);
      expect(code).toContain("classAssignments:");
      expect(code).toContain("teacherClassIds");
      expect(code).toContain("archivedAt: null");
    }
  });

  it.each([
    "src/app/api/students/route.ts",
    "src/app/api/students/[id]/route.ts",
    "src/app/api/attendance/students/status/route.ts",
    "src/app/api/attendance/students/today/route.ts",
    "src/app/api/attendance/week/route.ts",
    "src/app/api/care-reports/route.ts",
    "src/app/api/care-reports/daily/route.ts",
    "src/app/api/care-reports/[id]/route.ts",
    "src/app/api/care-reports/photo/route.ts",
    "src/app/api/mobile/v1/care-reports/create/route.ts",
    "src/app/api/search/route.ts",
    "src/app/api/dashboard/tasks/route.ts",
    "src/app/api/notifications/alerts/route.ts",
    "src/app/api/reminders/route.ts",
    "src/app/api/invoices/generate/route.ts",
    "src/app/api/invoices/prefill/[student_id]/route.ts",
    "src/app/api/invoices/[id]/route.ts",
  ])("applies the central student predicate in %s", (file) => {
    expect(source(file)).toContain("studentClassWhere");
  });

  it.each([
    "src/app/api/financial-reports/route.ts",
    "src/app/api/financial-reports/[id]/route.ts",
    "src/app/api/financial-reports/generate/route.ts",
    "src/app/api/statistics/dashboard/route.ts",
    "src/app/api/statistics/export/excel/route.ts",
  ])("denies indivisible school-wide finance data to classroom accounts in %s", (file) => {
    expect(source(file)).toContain("scopedClassIds(session) !== null");
  });

  it("passes the same class scope into locked attendance and renewal operations", () => {
    const attendance = source("src/lib/attendance-operations.ts");
    const renewal = source("src/lib/student-renewal.ts");
    expect(attendance).toContain("classIds: readonly string[] | null");
    expect(attendance).toContain("classId: { in: [...input.classIds] }");
    expect(renewal).toContain("classId: { in: [...context.classIds] }");
  });

  it("does not let a classroom account import an unassigned school-wide roster", () => {
    for (const file of [
      "src/app/api/students/bulk/route.ts",
      "src/app/api/import/upload/route.ts",
      "src/app/api/import/[session_id]/route.ts",
      "src/app/api/import/[session_id]/mapping/route.ts",
      "src/app/api/import/[session_id]/detect-mapping/route.ts",
      "src/app/api/import/[session_id]/validate/route.ts",
      "src/app/api/import/[session_id]/confirm/route.ts",
    ]) {
      expect(source(file)).toContain("scopedClassIds(session) !== null");
    }
  });

  it("keeps unassigned enrollment submissions and their files manager-only", () => {
    for (const file of [
      "src/app/api/enrollment/submissions/route.ts",
      "src/app/api/enrollment/reject/[submission_id]/route.ts",
    ]) {
      expect(source(file)).toContain("scopedClassIds(session) !== null");
    }
    expect(source("src/lib/stored-file-access.ts")).toContain("scopedClassIds(session) === null");
  });
});
