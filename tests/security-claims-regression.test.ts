import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_TEMPLATES } from "@/lib/permissions";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("sensitive child health information", () => {
  it("uses a dedicated permission and only grants it to the intended default roles", () => {
    expect(PERMISSIONS.some((permission) => permission.key === "students.health")).toBe(true);
    expect(ROLE_TEMPLATES.find((role) => role.key === "special_ed")?.permissions)
      .toContain("students.health");
    expect(ROLE_TEMPLATES.find((role) => role.key === "teacher")?.permissions)
      .not.toContain("students.health");
    expect(ROLE_TEMPLATES.find((role) => role.key === "accountant")?.permissions)
      .not.toContain("students.health");
  });

  it("gates child responses, updates, imports and enrolment review health fields", () => {
    for (const path of [
      "src/app/api/students/route.ts",
      "src/app/api/students/[id]/route.ts",
      "src/app/api/students/bulk/route.ts",
      "src/app/api/import/[session_id]/confirm/route.ts",
      "src/app/api/enrollment/submissions/route.ts",
      "src/app/api/enrollment/approve/[submission_id]/route.ts",
    ]) {
      expect(source(path), path).toContain("students.health");
    }
  });

  it("backfills only the special-education system role", () => {
    const migration = source("prisma/migrations/20261031100000_student_health_permission/migration.sql");
    expect(migration).toContain("'special_ed'");
    expect(migration).toContain("'students.health'");
    expect(migration).not.toContain("'teacher'");
    expect(migration).not.toContain("'accountant'");
  });
});

describe("administrative change logging", () => {
  it("records expense creation, edits, stops and deletion in their transactions", () => {
    const routes = [
      "src/app/api/expenses/route.ts",
      "src/app/api/expenses/[id]/route.ts",
      "src/app/api/expenses/[id]/stop/route.ts",
    ];
    for (const path of routes) {
      const route = source(path);
      expect(route, path).toContain("prisma.$transaction");
      expect(route, path).toContain("tx.activityLog.create");
      expect(route, path).toContain("activityLogData");
    }
  });

  it("records policy changes and manual retention runs", () => {
    const policy = source("src/app/api/admin/data-retention/route.ts");
    expect(policy).toContain("prisma.$transaction");
    expect(policy).toContain("tx.adminActivityLog.create");
    expect(policy).toContain("data_retention_policy_updated");

    const run = source("src/app/api/admin/data-retention/run/route.ts");
    expect(run).toContain("prisma.adminActivityLog.create");
    expect(run).toContain("data_retention_sweep_run");
  });
});
