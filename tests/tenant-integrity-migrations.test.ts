import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const accounts = readFileSync(
  "prisma/migrations/20260813230000_account_student_tenant_integrity/migration.sql",
  "utf8"
);
const operations = readFileSync(
  "prisma/migrations/20260813231500_attendance_finance_tenant_integrity/migration.sql",
  "utf8"
);
const enrollment = readFileSync(
  "prisma/migrations/20260813233000_enrollment_device_tenant_integrity/migration.sql",
  "utf8"
);

describe("6E tenant-integrity migrations", () => {
  it("preflights every domain and never repairs conflicting tenant data", () => {
    for (const sql of [accounts, operations, enrollment]) {
      expect(sql).toMatch(/RAISE EXCEPTION/);
      expect(sql).not.toMatch(/DELETE\s+FROM/i);
    }
    expect(accounts).toContain("User/Role tenant conflicts");
    expect(accounts).toContain("StudentGuardian tenant conflicts");
    expect(operations).toContain("CareReport/Class missing or tenant-conflicting references");
    expect(operations).toContain("PaymentCycle/Student tenant conflicts");
    expect(enrollment).toContain("EnrollmentSubmission/Token tenant conflicts");
    expect(enrollment).toContain("DeviceToken owner conflicts");
  });

  it("represents every composite foreign key in the Prisma schema", () => {
    expect(schema).toContain("@relation(fields: [roleId, schoolId], references: [id, schoolId]");
    expect(schema).toContain("@relation(fields: [studentId, schoolId], references: [id, schoolId]");
    expect(schema).toContain("@relation(fields: [teacherId, schoolId], references: [id, schoolId]");
    expect(schema).toContain("@relation(fields: [token_id, school_id], references: [id, school_id]");
    expect(schema).toContain("@relation(fields: [userId, schoolId], references: [id, schoolId]");
  });
});
