import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_JOB_TITLE_VALUES,
  normalizeEmployeeJobTitle,
} from "@/lib/employee-role-options";
import { teacherFormSchema } from "@/lib/form-schemas";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("employee job title and qualification fields", () => {
  it("offers exactly the five agreed assignable job titles", () => {
    expect(EMPLOYEE_JOB_TITLE_VALUES).toEqual([
      "admin_assistant",
      "teacher",
      "teacher_assistant",
      "accountant",
      "hr",
    ]);
  });

  it("requires an assignable title and refuses the protected manager role", () => {
    expect(teacherFormSchema.safeParse({ name: "سارة" }).success).toBe(false);
    expect(
      teacherFormSchema.safeParse({ name: "سارة", jobTitle: "teacher" }).success
    ).toBe(true);
    expect(
      teacherFormSchema.safeParse({ name: "سارة", jobTitle: "manager" }).success
    ).toBe(false);
  });

  it("maps legacy Arabic titles into the fixed picker without granting manager", () => {
    expect(normalizeEmployeeJobTitle("معلمة")).toBe("teacher");
    expect(normalizeEmployeeJobTitle("مساعدة معلمة")).toBe("teacher_assistant");
    expect(normalizeEmployeeJobTitle("محاسبة")).toBe("accountant");
    expect(normalizeEmployeeJobTitle("مديرة")).toBe("");
  });

  it("collects and persists the complete employee details on creation", () => {
    const page = source("src/app/(dashboard)/teachers/new/page.tsx");
    const route = source("src/app/api/teachers/route.ts");

    for (const field of [
      "jobTitle",
      "educationLevel",
      "specialization",
    ]) {
      expect(page, field).toContain(field);
      expect(route, field).toContain(field);
    }
    expect(page).toContain("MAX_EXTRA_QUALIFICATIONS = 7");
    expect(route).toContain("qualification10");
    expect(route).toContain("jobTitle,");
    expect(route).toContain("...(educationLevel != null && { educationLevel })");
  });
});
