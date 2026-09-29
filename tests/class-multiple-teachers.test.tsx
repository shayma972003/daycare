// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/i18n-provider", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    key === "classes.removeTeacher" ? `remove ${vars?.name ?? ""}` : key,
}));

import { TeacherMultiSelect } from "@/components/classes/TeacherMultiSelect";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("multiple teachers per class", () => {
  it("adds an isolated tenant-scoped join and backfills the existing teacher", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260913120000_multiple_teachers_per_class/migration.sql"
    );

    expect(schema).toContain("model ClassTeacher");
    expect(schema).toContain("@@id([schoolId, classId, teacherId])");
    expect(migration).toContain('REFERENCES "Class"("id", "schoolId")');
    expect(migration).toContain('REFERENCES "Teacher"("id", "schoolId")');
    expect(migration).toContain('SELECT "schoolId", "id", "teacherId"');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM/i);
  });

  it("persists the full teacher list while keeping the legacy primary pointer", () => {
    const createRoute = source("src/app/api/classes/route.ts");
    const updateRoute = source("src/app/api/classes/[id]/route.ts");

    expect(createRoute).toContain("teacherIds: z.array");
    expect(createRoute).toContain("tx.classTeacher.createMany");
    expect(createRoute).toContain("prisma.$transaction");
    expect(createRoute).toContain("teacherId: ownedTeacherIds[0] ?? null");
    expect(updateRoute).toContain("tx.classTeacher.deleteMany");
    expect(updateRoute).toContain("tx.classTeacher.createMany");
    expect(updateRoute).toContain("updateData.needsTeacherWarning = assignmentTeacherIds.length === 0");
  });

  it("uses every assignment for app rosters and announcement recipients", () => {
    const mobileRoster = source("src/app/api/mobile/v1/attendance/today/route.ts");
    const mobileGuard = source("src/lib/mobile-guard.ts");
    const activitySend = source("src/app/api/activities/[id]/send/route.ts");
    const calendarSend = source("src/app/api/calendar/[id]/send/route.ts");

    expect(mobileGuard).toContain("classAssignments:");
    expect(mobileRoster).toContain("scopedClassIds(context)");
    expect(activitySend).toContain("teacherAssignments: { select: { teacherId: true } }");
    expect(calendarSend).toContain("teacherAssignments: { select: { teacherId: true } }");
  });

  it("lets the manager search, select, and remove more than one teacher", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TeacherMultiSelect
        teachers={[
          { id: "teacher-1", name: "نورة" },
          { id: "teacher-2", name: "سارة" },
        ]}
        selectedIds={[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByLabelText("نورة"));
    expect(onChange).toHaveBeenLastCalledWith(["teacher-1"]);

    rerender(
      <TeacherMultiSelect
        teachers={[
          { id: "teacher-1", name: "نورة" },
          { id: "teacher-2", name: "سارة" },
        ]}
        selectedIds={["teacher-1", "teacher-2"]}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "سارة" } });
    expect(screen.queryByLabelText("نورة")).toBeNull();
    expect((screen.getByLabelText("سارة") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "remove نورة" }));
    expect(onChange).toHaveBeenLastCalledWith(["teacher-2"]);
  });

  it("ships the class teacher selector labels in both locales", () => {
    const ar = JSON.parse(source("locales/ar.json"));
    const en = JSON.parse(source("locales/en.json"));

    expect(ar.classes.form.teachers).toBe("معلمات الفصل");
    expect(ar.classes.searchTeachers).toBe("ابحثي عن معلمة...");
    expect(en.classes.form.teachers).toBe("Class Teachers");
    expect(en.classes.noTeachersFound).toBe("No matching teachers");
  });
});
