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
for (const value of [baseUrl, directUrl]) {
  if (!new URL(value).hostname.toLowerCase().includes("neon")) {
    throw new Error("Refusing 6B1 verification: provider is not Neon");
  }
}

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const freshSchema = `codex_6b1_fresh_${suffix}`;
const upgradeSchema = `codex_6b1_upgrade_${suffix}`;
const schemas = [freshSchema, upgradeSchema];

function ident(value) {
  if (!/^codex_6b1_[a-z0-9_]+$/.test(value) || value === "public") {
    throw new Error("Unsafe temporary schema identifier");
  }
  return `"${value}"`;
}

function schemaUrl(schema, forPg = false) {
  const url = new URL(directUrl);
  url.searchParams.set("schema", schema);
  if (forPg) url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function redact(value, urls = []) {
  let safe = String(value ?? "");
  for (const secret of [baseUrl, directUrl, ...urls]) safe = safe.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  return safe;
}

function runNode(label, args, env, urls = []) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, urls).slice(-5000)}`);
  }
}

async function publicFingerprint(client) {
  const metadata = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS fingerprint
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ) AS public_columns
  `);
  const migrationsTable = await client.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`
  );
  let migrations = "absent";
  if (migrationsTable.rows[0]?.present) {
    const result = await client.query(`
      SELECT md5(COALESCE(string_agg(
        "migration_name" || ':' || COALESCE("finished_at"::text, ''),
        ',' ORDER BY "migration_name"
      ), '')) AS fingerprint
      FROM public."_prisma_migrations"
    `);
    migrations = result.rows[0]?.fingerprint ?? "empty";
  }
  return { metadata: metadata.rows[0]?.fingerprint ?? "empty", migrations };
}

async function publicCanaryCount(client) {
  const present = await client.query(`SELECT to_regclass('public."StoredFile"') IS NOT NULL AS present`);
  if (!present.rows[0]?.present) return 0;
  const result = await client.query(
    `SELECT count(*)::int AS count FROM public."StoredFile" WHERE "key" LIKE 'schools/codex6b1\_%' ESCAPE '\\'`
  );
  return result.rows[0]?.count ?? 0;
}

async function applyPreviousMigrations(client) {
  const root = join(process.cwd(), "prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "20260812023000_stored_file_ownership")
    .sort();
  for (const name of names) {
    await client.query(await readFile(join(root, name, "migration.sql"), "utf8"));
  }
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: "Neon PostgreSQL",
  connection: false,
  freshMigrations: false,
  migrateStatus: false,
  migrateDiffClean: false,
  explicitPrismaPgSchema: false,
  publicCanaryAbsent: false,
  approvedBackfill: false,
  pendingBackfill: false,
  directStudentBackfill: false,
  ambiguousStayedLegacy: false,
  orphanStayedLegacy: false,
  ownershipIndexPresent: false,
  concurrentTransitionWinners: 0,
  finalStudentOwnership: false,
  failedTransactionRolledBack: false,
  publicUnchanged: false,
  temporarySchemasRemoved: false,
};

let connected = false;
let publicBefore;
let failure;
try {
  await admin.connect();
  connected = true;
  await admin.query("SELECT 1");
  results.connection = true;
  publicBefore = await publicFingerprint(admin);
  if ((await publicCanaryCount(admin)) !== 0) {
    throw new Error("public contains a codex6b1 canary row; refusing to continue");
  }

  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${ident(schema)}`);

  const freshUrl = schemaUrl(freshSchema);
  const freshEnv = { ...process.env, DATABASE_URL: freshUrl, DIRECT_DATABASE_URL: freshUrl };
  runNode(
    "prisma migrate deploy",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    freshEnv,
    [freshUrl]
  );
  results.freshMigrations = true;
  runNode(
    "prisma migrate status",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"],
    freshEnv,
    [freshUrl]
  );
  results.migrateStatus = true;
  runNode(
    "prisma migrate diff",
    [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--exit-code",
    ],
    freshEnv,
    [freshUrl]
  );
  results.migrateDiffClean = true;

  const canarySchool = `codex6b1_${suffix}_school`;
  const canaryKey = `schools/${canarySchool}/students/canary/file.pdf`;
  runNode(
    "PrismaPg StoredFile canary",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/stored-file-prisma-canary.test.ts"],
    {
      ...process.env,
      DATABASE_URL: baseUrl,
      STORED_FILE_POSTGRES_SCHEMA: freshSchema,
      STORED_FILE_CANARY_KEY: canaryKey,
      STORED_FILE_CANARY_SCHOOL: canarySchool,
    },
    [freshUrl]
  );
  const canary = await admin.query(
    `SELECT count(*)::int AS count FROM ${ident(freshSchema)}."StoredFile" WHERE "key" = $1`,
    [canaryKey]
  );
  results.explicitPrismaPgSchema = canary.rows[0]?.count === 1;
  results.publicCanaryAbsent = (await publicCanaryCount(admin)) === 0;

  const upgrade = new Pool({ connectionString: schemaUrl(upgradeSchema, true), max: 4 });
  try {
    await applyPreviousMigrations(upgrade);
    const s = ident(upgradeSchema);
    const now = new Date();
    await upgrade.query(
      `INSERT INTO ${s}."School" ("id", "name", "updatedAt") VALUES
       ('6b1_school_a', 'School A', $1), ('6b1_school_b', 'School B', $1)`,
      [now]
    );
    await upgrade.query(
      `INSERT INTO ${s}."EnrollmentToken" ("id", "school_id", "token", "expires_at") VALUES
       ('6b1_token_a', '6b1_school_a', '6b1_raw_a', NOW() + interval '1 day'),
       ('6b1_token_b', '6b1_school_a', '6b1_raw_b', NOW() + interval '1 day')`
    );
    await upgrade.query(
      `INSERT INTO ${s}."Student" ("id", "name", "schoolId", "updatedAt") VALUES
       ('6b1_student_approved', 'Approved', '6b1_school_a', $1),
       ('6b1_student_direct', 'Direct', '6b1_school_a', $1)`,
      [now]
    );
    const approvedKey = "schools/6b1_school_a/students/enrollment/approved.pdf";
    const pendingKey = "schools/6b1_school_a/students/enrollment/pending.pdf";
    const ambiguousKey = "schools/6b1_school_a/students/enrollment/ambiguous.pdf";
    const orphanKey = "schools/6b1_school_a/students/enrollment/orphan.pdf";
    const directKey = "schools/6b1_school_a/students/6b1_student_direct/direct.pdf";
    await upgrade.query(
      `INSERT INTO ${s}."EnrollmentSubmission"
       ("id", "token_id", "school_id", "status", "full_name", "evaluation_file_url", "student_id") VALUES
       ('6b1_sub_approved', '6b1_token_a', '6b1_school_a', 'approved', 'Approved', $1, '6b1_student_approved'),
       ('6b1_sub_pending', '6b1_token_b', '6b1_school_a', 'pending_review', 'Pending', $2, NULL),
       ('6b1_sub_amb_a', '6b1_token_a', '6b1_school_a', 'pending_review', 'Amb A', $3, NULL),
       ('6b1_sub_amb_b', '6b1_token_b', '6b1_school_a', 'pending_review', 'Amb B', $3, NULL)`,
      [`/api/files/${approvedKey}`, `/api/files/${pendingKey}`, `/api/files/${ambiguousKey}`]
    );
    await upgrade.query(
      `INSERT INTO ${s}."StoredFile"
       ("key", "schoolId", "category", "ownerId", "contentType", "sizeBytes") VALUES
       ($1, '6b1_school_a', 'students', 'enrollment', 'application/pdf', 1),
       ($2, '6b1_school_a', 'students', 'enrollment', 'application/pdf', 1),
       ($3, '6b1_school_a', 'students', 'enrollment', 'application/pdf', 1),
       ($4, '6b1_school_a', 'students', 'enrollment', 'application/pdf', 1),
       ($5, '6b1_school_a', 'students', '6b1_student_direct', 'application/pdf', 1)`,
      [approvedKey, pendingKey, ambiguousKey, orphanKey, directKey]
    );

    const migration = await readFile(
      join(process.cwd(), "prisma/migrations/20260812023000_stored_file_ownership/migration.sql"),
      "utf8"
    );
    await upgrade.query(migration);
    const backfill = await upgrade.query(
      `SELECT "key", "ownerType"::text, "ownerId" FROM ${s}."StoredFile"
       WHERE "key" = ANY($1::text[])`,
      [[approvedKey, pendingKey, ambiguousKey, orphanKey, directKey]]
    );
    const row = (key) => backfill.rows.find((item) => item.key === key);
    results.approvedBackfill = row(approvedKey)?.ownerType === "STUDENT" && row(approvedKey)?.ownerId === "6b1_student_approved";
    results.pendingBackfill = row(pendingKey)?.ownerType === "ENROLLMENT_SUBMISSION" && row(pendingKey)?.ownerId === "6b1_sub_pending";
    results.directStudentBackfill = row(directKey)?.ownerType === "STUDENT" && row(directKey)?.ownerId === "6b1_student_direct";
    results.ambiguousStayedLegacy = row(ambiguousKey)?.ownerType === "LEGACY" && row(ambiguousKey)?.ownerId === "enrollment";
    results.orphanStayedLegacy = row(orphanKey)?.ownerType === "LEGACY" && row(orphanKey)?.ownerId === "enrollment";
    const index = await upgrade.query(
      `SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname = $1 AND indexname = 'StoredFile_schoolId_ownerType_ownerId_idx'`,
      [upgradeSchema]
    );
    results.ownershipIndexPresent = index.rows[0]?.count === 1;

    const raceKey = "schools/6b1_school_a/students/6b1_token_a/race.pdf";
    await upgrade.query(
      `INSERT INTO ${s}."StoredFile"
       ("key", "schoolId", "category", "ownerId", "ownerType", "contentType", "sizeBytes")
       VALUES ($1, '6b1_school_a', 'students', '6b1_token_a', 'ENROLLMENT_TOKEN', 'application/pdf', 1)`,
      [raceKey]
    );
    const transition = (nextOwner) => upgrade.query(
      `UPDATE ${s}."StoredFile" SET "ownerType" = 'ENROLLMENT_SUBMISSION', "ownerId" = $2
       WHERE "key" = $1 AND "schoolId" = '6b1_school_a'
         AND "ownerType" = 'ENROLLMENT_TOKEN' AND "ownerId" = '6b1_token_a'
         AND "deletePendingAt" IS NULL RETURNING "key"`,
      [raceKey, nextOwner]
    );
    const races = await Promise.all([transition("6b1_sub_amb_a"), transition("6b1_sub_amb_b")]);
    results.concurrentTransitionWinners = races.filter((result) => result.rowCount === 1).length;
    const winner = races[0].rowCount === 1 ? "6b1_sub_amb_a" : "6b1_sub_amb_b";
    const toStudent = await upgrade.query(
      `UPDATE ${s}."StoredFile" SET "ownerType" = 'STUDENT', "ownerId" = '6b1_student_direct'
       WHERE "key" = $1 AND "schoolId" = '6b1_school_a'
         AND "ownerType" = 'ENROLLMENT_SUBMISSION' AND "ownerId" = $2 RETURNING "key"`,
      [raceKey, winner]
    );
    results.finalStudentOwnership = toStudent.rowCount === 1;

    const rollbackKey = "schools/6b1_school_a/students/6b1_token_b/rollback.pdf";
    await upgrade.query(
      `INSERT INTO ${s}."StoredFile"
       ("key", "schoolId", "category", "ownerId", "ownerType", "contentType", "sizeBytes")
       VALUES ($1, '6b1_school_a', 'students', '6b1_token_b', 'ENROLLMENT_TOKEN', 'application/pdf', 1)`,
      [rollbackKey]
    );
    const tx = await upgrade.connect();
    try {
      await tx.query("BEGIN");
      await tx.query(
        `INSERT INTO ${s}."Student" ("id", "name", "schoolId", "updatedAt")
         VALUES ('6b1_rolled_back_student', 'Rollback', '6b1_school_a', $1)`,
        [now]
      );
      const moved = await tx.query(
        `UPDATE ${s}."StoredFile" SET "ownerType" = 'STUDENT', "ownerId" = '6b1_rolled_back_student'
         WHERE "key" = $1 AND "ownerType" = 'ENROLLMENT_SUBMISSION' RETURNING "key"`,
        [rollbackKey]
      );
      if (moved.rowCount !== 1) throw new Error("conditional ownership transfer failed");
      await tx.query("COMMIT");
    } catch {
      await tx.query("ROLLBACK");
    } finally {
      tx.release();
    }
    const rollback = await upgrade.query(
      `SELECT
         (SELECT count(*) FROM ${s}."Student" WHERE "id" = '6b1_rolled_back_student')::int AS students,
         (SELECT count(*) FROM ${s}."StoredFile" WHERE "key" = $1 AND "ownerType" = 'ENROLLMENT_TOKEN' AND "ownerId" = '6b1_token_b')::int AS files`,
      [rollbackKey]
    );
    results.failedTransactionRolledBack = rollback.rows[0]?.students === 0 && rollback.rows[0]?.files === 1;
  } finally {
    await upgrade.end();
  }
} catch (error) {
  failure = error;
} finally {
  try {
    if (connected) {
      for (const schema of schemas) {
        if (!schema.startsWith("codex_6b1_") || schema === "public") {
          throw new Error("Refusing to drop unsafe schema");
        }
        await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
      }
      const remaining = await admin.query(
        `SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
        [schemas]
      );
      results.temporarySchemasRemoved = remaining.rows[0]?.count === 0;
      const publicAfter = await publicFingerprint(admin);
      results.publicUnchanged =
        publicBefore?.metadata === publicAfter.metadata &&
        publicBefore?.migrations === publicAfter.migrations &&
        (await publicCanaryCount(admin)) === 0;
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
  } finally {
    if (connected) await admin.end();
  }
}

if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure));
for (const [key, value] of Object.entries(results)) {
  if (["provider", "connection", "concurrentTransitionWinners"].includes(key)) continue;
  if (value !== true) throw new Error(`6B1 verification failed: ${key}`);
}
if (results.connection !== true) throw new Error("6B1 connection failed");
if (results.concurrentTransitionWinners !== 1) {
  throw new Error("Concurrent ownership transition did not have exactly one winner");
}

console.log(JSON.stringify(results, null, 2));
