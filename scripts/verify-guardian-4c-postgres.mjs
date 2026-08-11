import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client, Pool } = pg;
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is not configured");
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;

const parsed = new URL(baseUrl);
if (!parsed.hostname.toLowerCase().includes("neon")) {
  throw new Error("Refusing 4C database verification: provider is not Neon");
}

const suffix = `${Date.now()}_${randomBytes(3).toString("hex")}`;
const migratedSchema = `codex_4c_valid_${suffix}`;
const conflictSchema = `codex_4c_conflict_${suffix}`;
const schemas = [migratedSchema, conflictSchema];
if (schemas.some((name) => !/^codex_4c_[a-z0-9_]+$/.test(name) || name === "public")) {
  throw new Error("Unsafe temporary schema name");
}

function ident(value) {
  if (!/^codex_4c_[a-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier");
  return `"${value}"`;
}

function schemaUrl(schema, forPg = false) {
  const url = new URL(directUrl);
  url.searchParams.set("schema", schema);
  if (forPg) url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function prisma(args, schema) {
  const url = schemaUrl(schema);
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules/prisma/build/index.js"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    }
  );
  if (result.status !== 0) {
    const safe = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
      .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]")
      .replaceAll(url, "[REDACTED_TEST_URL]")
      .slice(-3000);
    throw new Error(`Prisma ${args.join(" ")} failed: ${safe}`);
  }
}

async function publicFingerprint(client) {
  const exists = await client.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`
  );
  if (!exists.rows[0]?.present) return "absent";
  const result = await client.query(`
    SELECT md5(COALESCE(string_agg(
      "migration_name" || ':' || COALESCE("finished_at"::text, ''),
      ',' ORDER BY "migration_name"
    ), '')) AS fingerprint
    FROM public."_prisma_migrations"
  `);
  return result.rows[0]?.fingerprint ?? "empty";
}

async function applyPreviousMigrations(client) {
  const root = join(process.cwd(), "prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "20260812003000_guardian_account_tenant_integrity")
    .sort();
  for (const name of names) {
    const sql = await readFile(join(root, name, "migration.sql"), "utf8");
    await client.query(sql);
  }
}

async function expectPgCode(operation, code, label) {
  try {
    await operation();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`${label} failed with unexpected PostgreSQL code ${error?.code ?? "none"}`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: "Neon PostgreSQL",
  connection: "pending",
  allMigrations: false,
  migrateStatus: false,
  schemaMatches: false,
  matchingTenant: false,
  crossTenantRejected: false,
  guardianUniquePreserved: false,
  emailUniquePreserved: false,
  passwordResetSubjectCheck: false,
  guardianCascade: false,
  schoolCascade: false,
  concurrentAcceptanceWinners: 0,
  conflictMigrationRejected: false,
  conflictMigrationPreservedRows: false,
  publicUnchanged: false,
  temporarySchemasRemoved: false,
};

let publicBefore;
try {
  await admin.connect();
  await admin.query("SELECT 1");
  results.connection = "ok";
  publicBefore = await publicFingerprint(admin);

  for (const schema of schemas) {
    await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  }

  prisma(["migrate", "deploy"], migratedSchema);
  results.allMigrations = true;
  prisma(["migrate", "status"], migratedSchema);
  results.migrateStatus = true;
  prisma(
    [
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema=prisma/schema.prisma",
      "--exit-code",
    ],
    migratedSchema
  );
  results.schemaMatches = true;

  const pool = new Pool({ connectionString: schemaUrl(migratedSchema, true), max: 4 });
  const s = ident(migratedSchema);
  try {
    const current = await pool.query("SELECT current_schema() AS schema");
    if (current.rows[0]?.schema !== migratedSchema) {
      throw new Error("Prisma/pg test connection did not select the temporary schema");
    }

    const now = new Date();
    await pool.query(
      `INSERT INTO ${s}."School" ("id", "name", "updatedAt") VALUES
       ('4c_school_a', '4C School A', $1),
       ('4c_school_b', '4C School B', $1),
       ('4c_school_c', '4C School C', $1),
       ('4c_school_d', '4C School D', $1)`,
      [now]
    );
    await pool.query(
      `INSERT INTO ${s}."Guardian" ("id", "schoolId", "name", "updatedAt") VALUES
       ('4c_guardian_a', '4c_school_a', 'Guardian A', $1),
       ('4c_guardian_cross', '4c_school_a', 'Guardian Cross', $1),
       ('4c_guardian_b', '4c_school_b', 'Guardian B', $1),
       ('4c_guardian_c', '4c_school_c', 'Guardian C', $1),
       ('4c_guardian_d', '4c_school_d', 'Guardian D', $1)`,
      [now]
    );
    await pool.query(
      `INSERT INTO ${s}."GuardianAccount"
       ("id", "schoolId", "guardianId", "email", "inviteTokenHash", "inviteExpiresAt", "updatedAt")
       VALUES ('4c_account_a', '4c_school_a', '4c_guardian_a', 'a@4c.test', 'hash-a', NOW() + interval '1 day', $1)`,
      [now]
    );
    results.matchingTenant = true;

    await expectPgCode(
      () =>
        pool.query(
          `INSERT INTO ${s}."GuardianAccount"
           ("id", "schoolId", "guardianId", "email", "updatedAt")
           VALUES ('4c_cross', '4c_school_b', '4c_guardian_cross', 'cross@4c.test', $1)`,
          [now]
        ),
      "23503",
      "cross-tenant guardian account"
    );
    results.crossTenantRejected = true;

    await expectPgCode(
      () =>
        pool.query(
          `INSERT INTO ${s}."GuardianAccount"
           ("id", "schoolId", "guardianId", "email", "updatedAt")
           VALUES ('4c_dup_guardian', '4c_school_a', '4c_guardian_a', 'other@4c.test', $1)`,
          [now]
        ),
      "23505",
      "guardian uniqueness"
    );
    results.guardianUniquePreserved = true;

    await pool.query(
      `INSERT INTO ${s}."GuardianAccount"
       ("id", "schoolId", "guardianId", "email", "inviteTokenHash", "inviteExpiresAt", "updatedAt")
       VALUES ('4c_account_b', '4c_school_b', '4c_guardian_b', 'b@4c.test', 'race-hash', NOW() + interval '1 day', $1)`,
      [now]
    );
    await expectPgCode(
      () =>
        pool.query(
          `UPDATE ${s}."GuardianAccount" SET "email" = 'a@4c.test'
           WHERE "id" = '4c_account_b'`
        ),
      "23505",
      "email uniqueness"
    );
    results.emailUniquePreserved = true;

    const casSql = `
      UPDATE ${s}."GuardianAccount"
         SET "passwordHash" = $1,
             "acceptedAt" = NOW(),
             "inviteTokenHash" = NULL,
             "inviteExpiresAt" = NULL,
             "updatedAt" = NOW()
       WHERE "id" = '4c_account_b'
         AND "inviteTokenHash" = 'race-hash'
         AND "inviteExpiresAt" > NOW()
         AND "disabledAt" IS NULL
       RETURNING "id"`;
    const claims = await Promise.all([
      pool.query(casSql, ["password-hash-one"]),
      pool.query(casSql, ["password-hash-two"]),
    ]);
    results.concurrentAcceptanceWinners = claims.filter((claim) => claim.rowCount === 1).length;
    if (results.concurrentAcceptanceWinners !== 1) {
      throw new Error("Concurrent guardian invitation acceptance did not have exactly one winner");
    }

    await pool.query(
      `INSERT INTO ${s}."PasswordResetToken"
       ("id", "guardianAccountId", "tokenHash", "expiresAt")
       VALUES ('4c_reset_guardian', '4c_account_b', 'reset-hash', NOW() + interval '1 day')`
    );
    await expectPgCode(
      () =>
        pool.query(
          `INSERT INTO ${s}."PasswordResetToken"
           ("id", "tokenHash", "expiresAt")
           VALUES ('4c_reset_none', 'none-hash', NOW() + interval '1 day')`
        ),
      "23514",
      "reset token subject check"
    );
    results.passwordResetSubjectCheck = true;

    await pool.query(
      `INSERT INTO ${s}."GuardianAccount"
       ("id", "schoolId", "guardianId", "email", "updatedAt")
       VALUES ('4c_account_c', '4c_school_c', '4c_guardian_c', 'c@4c.test', $1),
              ('4c_account_d', '4c_school_d', '4c_guardian_d', 'd@4c.test', $1)`,
      [now]
    );
    await pool.query(`DELETE FROM ${s}."Guardian" WHERE "id" = '4c_guardian_c'`);
    const afterGuardianDelete = await pool.query(
      `SELECT count(*)::int AS count FROM ${s}."GuardianAccount" WHERE "id" = '4c_account_c'`
    );
    results.guardianCascade = afterGuardianDelete.rows[0]?.count === 0;

    await pool.query(`DELETE FROM ${s}."School" WHERE "id" = '4c_school_d'`);
    const afterSchoolDelete = await pool.query(
      `SELECT
         (SELECT count(*) FROM ${s}."Guardian" WHERE "id" = '4c_guardian_d')::int AS guardians,
         (SELECT count(*) FROM ${s}."GuardianAccount" WHERE "id" = '4c_account_d')::int AS accounts`
    );
    results.schoolCascade =
      afterSchoolDelete.rows[0]?.guardians === 0 && afterSchoolDelete.rows[0]?.accounts === 0;
  } finally {
    await pool.end();
  }

  const conflictClient = new Client({ connectionString: schemaUrl(conflictSchema, true) });
  try {
    await conflictClient.connect();
    const current = await conflictClient.query("SELECT current_schema() AS schema");
    if (current.rows[0]?.schema !== conflictSchema) {
      throw new Error("Conflict test did not select the temporary schema");
    }
    await applyPreviousMigrations(conflictClient);
    const c = ident(conflictSchema);
    const now = new Date();
    await conflictClient.query(
      `INSERT INTO ${c}."School" ("id", "name", "updatedAt") VALUES
       ('4c_conflict_school_a', 'Conflict A', $1),
       ('4c_conflict_school_b', 'Conflict B', $1)`,
      [now]
    );
    await conflictClient.query(
      `INSERT INTO ${c}."Guardian" ("id", "schoolId", "name", "updatedAt")
       VALUES ('4c_conflict_guardian', '4c_conflict_school_a', 'Conflict Guardian', $1)`,
      [now]
    );
    await conflictClient.query(
      `INSERT INTO ${c}."GuardianAccount"
       ("id", "schoolId", "guardianId", "email", "updatedAt")
       VALUES ('4c_conflict_account', '4c_conflict_school_b', '4c_conflict_guardian', 'conflict@4c.test', $1)`,
      [now]
    );
    const migration = await readFile(
      join(
        process.cwd(),
        "prisma/migrations/20260812003000_guardian_account_tenant_integrity/migration.sql"
      ),
      "utf8"
    );
    try {
      await conflictClient.query(migration);
      throw new Error("Tenant integrity migration accepted a conflicting legacy row");
    } catch (error) {
      if (!String(error?.message).includes("Cannot enforce GuardianAccount tenant consistency")) {
        throw error;
      }
      // The migration owns its BEGIN. PostgreSQL keeps the connection in the
      // failed transaction until an explicit rollback, which is also the proof
      // that no partial constraint changes survive the guard failure.
      await conflictClient.query("ROLLBACK");
      results.conflictMigrationRejected = true;
    }
    const preserved = await conflictClient.query(
      `SELECT count(*)::int AS count FROM ${c}."GuardianAccount"
       WHERE "id" = '4c_conflict_account'`
    );
    results.conflictMigrationPreservedRows = preserved.rows[0]?.count === 1;
  } finally {
    await conflictClient.end();
  }
} finally {
  for (const schema of schemas) {
    if (!schema.startsWith("codex_4c_") || schema === "public") {
      throw new Error("Refusing to drop unsafe schema");
    }
    await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
  }
  const remaining = await admin.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
    [schemas]
  );
  results.temporarySchemasRemoved = remaining.rowCount === 0;
  const publicAfter = await publicFingerprint(admin);
  results.publicUnchanged = publicBefore === publicAfter;
  await admin.end();
}

for (const [key, value] of Object.entries(results)) {
  if (key === "provider" || key === "connection" || key === "concurrentAcceptanceWinners") continue;
  if (value !== true) throw new Error(`4C verification failed: ${key}`);
}

console.log(JSON.stringify(results, null, 2));
