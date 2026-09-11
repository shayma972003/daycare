import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("tenant-scoped database references", () => {
  const migrationPath =
    "prisma/migrations/20260907183000_tenant_scoped_reference_constraints/migration.sql";

  it("models cross-tenant-sensitive references with schoolId in the foreign key", () => {
    const schema = read("prisma/schema.prisma");
    for (const relation of [
      "@relation(fields: [teacherId, schoolId], references: [id, schoolId], onDelete: Restrict)",
      "@relation(fields: [stageId, schoolId], references: [id, schoolId], onDelete: Restrict)",
      "@relation(fields: [classId, schoolId], references: [id, schoolId], onDelete: Restrict)",
      "@relation(fields: [unitId, schoolId], references: [id, schoolId], onDelete: Restrict)",
    ]) {
      expect(schema).toContain(relation);
    }
  });

  it("aborts on historical ownership mismatches instead of repairing data", () => {
    const migration = read(migrationPath);
    for (const reference of [
      "Class.teacherId",
      "Class.stageId",
      "Activity.teacherId",
      "Activity.stageId",
      "Shift.classId",
      "CalendarEvent.teacherId",
      "CalendarEvent.unitId",
      "User.teacherId",
    ]) {
      expect(migration).toContain(`tenant mismatch: ${reference}`);
    }
    expect(migration).not.toMatch(/^UPDATE\s/im);
    expect(migration).not.toMatch(/^DELETE\s/im);
  });

  it("detaches staff accounts before a teacher is permanently removed", () => {
    for (const path of [
      "src/app/api/trash/permanent/teacher/[id]/route.ts",
      "src/lib/trash-cleanup.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("tx.user.updateMany");
      expect(source.indexOf("tx.user.updateMany"))
        .toBeLessThan(source.indexOf("tx.teacher.delete"));
    }
  });
});
