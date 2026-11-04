import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEducationLevel,
  normalizeEmployeeJobTitle,
} from "@/lib/employee-role-options";
import {
  detectMapping,
  TEACHER_FIELD_ALIASES,
} from "@/lib/import-mapper";
import { validateImportRow } from "@/lib/import-row-validation";

describe("employee spreadsheet import", () => {
  it("recognizes the employee columns added after the staff conversion", () => {
    expect(TEACHER_FIELD_ALIASES).toMatchObject({
      job_title: expect.any(Array),
      payment_method: expect.any(Array),
      education_level: expect.any(Array),
      specialization: expect.any(Array),
      enrollment_end_date: expect.any(Array),
      qualification_10: expect.any(Array),
    });

    const mapping = detectMapping([
      "اسم الموظف",
      "المسمى الوظيفي",
      "المستوى التعليمي",
      "تاريخ انتهاء العقد",
      "المؤهل 10",
    ], "teachers");

    expect(mapping.map(({ mappedField }) => mappedField)).toEqual([
      "full_name",
      "job_title",
      "education_level",
      "enrollment_end_date",
      "qualification_10",
    ]);
  });

  it("normalizes supported employee roles and education values", () => {
    expect(normalizeEmployeeJobTitle("معلمة")).toBe("teacher");
    expect(normalizeEmployeeJobTitle("ADMIN_ASSISTANT")).toBe("admin_assistant");
    expect(normalizeEducationLevel("بكالوريوس")).toBe("BACHELOR");
    expect(normalizeEducationLevel("master")).toBe("MASTER");
  });

  it("normalizes mapped employee values without blocking optional gaps", () => {
    const result = validateImportRow({
      rawData: {
        name: "سارة أحمد",
        role: "مساعد معلم",
        education: "دبلوم",
      },
      mappedData: null,
      errors: null,
      warnings: null,
    }, [
      { uploadedColumn: "name", mappedField: "full_name" },
      { uploadedColumn: "role", mappedField: "job_title" },
      { uploadedColumn: "education", mappedField: "education_level" },
    ], "teachers");

    expect(result.errors).toEqual([]);
    expect(result.mappedData).toMatchObject({
      full_name: "سارة أحمد",
      job_title: "teacher_assistant",
      education_level: "DIPLOMA",
    });
  });

  it("shows a column guide on both employee and child upload pages", () => {
    const teacherPage = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/teachers/import/page.tsx"),
      "utf8"
    );
    const studentPage = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/students/import/page.tsx"),
      "utf8"
    );
    expect(teacherPage).toContain('<ImportColumnsHelp type="teachers" />');
    expect(studentPage).toContain('<ImportColumnsHelp type="students" />');
  });

  it("persists every extended employee field during confirmation", () => {
    const confirm = readFileSync(
      join(process.cwd(), "src/app/api/import/[session_id]/confirm/route.ts"),
      "utf8"
    );
    for (const field of [
      "jobTitle",
      "paymentMethod",
      "educationLevel",
      "specialization",
      "qualification10",
      "enrollmentEndDate",
    ]) {
      expect(confirm).toContain(`${field}:`);
    }
  });
});
