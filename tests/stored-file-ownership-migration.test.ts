import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260812023000_stored_file_ownership/migration.sql"
  ),
  "utf8"
);
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const logoMigration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260902121000_school_logo_ownership_backfill/migration.sql"),
  "utf8"
);

describe("StoredFile ownership migration", () => {
  it("adds explicit lifecycle ownership and retryable deletion metadata", () => {
    expect(schema).toContain("enum StoredFileOwnerType");
    expect(schema).toContain("ENROLLMENT_TOKEN");
    expect(schema).toContain("ENROLLMENT_SUBMISSION");
    expect(schema).toContain("ownerType   StoredFileOwnerType @default(LEGACY)");
    expect(schema).toContain("deletePendingAt DateTime?");
    expect(migration).toContain('CREATE TYPE "StoredFileOwnerType"');
    expect(migration).toContain('"StoredFile_schoolId_ownerType_ownerId_idx"');
  });

  it("backfills only uniquely provable submission or student ownership", () => {
    expect(migration).toContain("linked.reference_count = 1");
    expect(migration).toContain("es.\"evaluation_file_url\" = '/api/files/' || sf.\"key\"");
    expect(migration).toContain("WHEN linked.approved THEN 'STUDENT'");
    expect(migration).toContain("ELSE 'ENROLLMENT_SUBMISSION'");
    expect(migration).toContain("student.\"schoolId\" = sf.\"schoolId\"");
  });

  it("leaves ambiguous legacy enrollment rows marked LEGACY without deleting them", () => {
    expect(migration).toContain("intentionally remain LEGACY");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"StoredFile"/i);
    expect(migration).not.toMatch(/ownerId\"\s*=\s*'enrollment'[\s\S]*ENROLLMENT_TOKEN/i);
  });

  it("backfills only an exact school logo reference and leaves ambiguous legacy files", () => {
    expect(schema).toContain("SCHOOL");
    expect(logoMigration).toContain("school.\"logoUrl\" = '/api/files/' || file.\"key\"");
    expect(logoMigration).toContain("file.\"schoolId\" = school.\"id\"");
    expect(logoMigration).toContain("file.\"category\" = 'school'");
    expect(logoMigration).not.toMatch(/DELETE\s+FROM/i);
    expect(logoMigration).not.toMatch(/ownerType"\s*=\s*'SCHOOL'[\s\S]*ownerType"\s*<>\s*'LEGACY'/i);
  });
});
