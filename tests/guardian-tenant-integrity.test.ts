import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260812003000_guardian_account_tenant_integrity/migration.sql"
  ),
  "utf8"
);
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("guardian account tenant integrity migration", () => {
  it("fails on legacy cross-tenant rows before replacing the foreign key", () => {
    expect(migration).toContain("Cannot enforce GuardianAccount tenant consistency");
    expect(migration.indexOf("RAISE EXCEPTION")).toBeLessThan(
      migration.indexOf('DROP CONSTRAINT "GuardianAccount_guardianId_fkey"')
    );
    expect(migration).not.toMatch(/UPDATE\s+"GuardianAccount"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"GuardianAccount"/i);
  });

  it("enforces the guardian and school pair while preserving global uniqueness", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("guardianId", "schoolId") REFERENCES "Guardian"("id", "schoolId")'
    );
    expect(schema).toContain(
      "guardian   Guardian @relation(fields: [guardianId, schoolId], references: [id, schoolId], onDelete: Cascade)"
    );
    expect(schema).toContain("guardianId String   @unique");
    expect(schema).toContain("email String  @unique");
  });

  it("gives reset tokens exactly one staff or guardian subject", () => {
    expect(migration).toContain("PasswordResetToken_exactly_one_subject_check");
    expect(migration).toContain('num_nonnulls("userId", "guardianAccountId") = 1');
    expect(schema).toContain("guardianAccountId String?");
  });
});
