import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
if (!pooledUrl || !directUrl) throw new Error("Staging database URLs are not configured");

function targetIdentity(value) {
  const url = new URL(value);
  return {
    provider: url.hostname.toLowerCase().includes("neon") ? "Neon PostgreSQL" : "other",
    endpoint: url.hostname.toLowerCase().replace("-pooler.", "."),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
  };
}

const pooledIdentity = targetIdentity(pooledUrl);
const directIdentity = targetIdentity(directUrl);
if (pooledIdentity.provider !== "Neon PostgreSQL" || directIdentity.provider !== "Neon PostgreSQL") {
  throw new Error("Refusing settings verification: target is not Neon");
}
if (JSON.stringify(pooledIdentity) !== JSON.stringify(directIdentity)) {
  throw new Error("Refusing settings verification: pooled and direct targets differ");
}

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const freshSchema = `codex_attendance_settings_fresh_${suffix}`;
const upgradeSchema = `codex_attendance_settings_upgrade_${suffix}`;
const schemas = [freshSchema, upgradeSchema];
const currentMigrations = new Set([
  "20260902120000_school_schedule_and_subscription_fees",
  "20260902121000_school_logo_ownership_backfill",
]);

function ident(value) {
  if (!/^codex_attendance_settings_[a-z0-9_]+$/.test(value) || value === "public") {
    throw new Error("Unsafe temporary schema identifier");
  }
  return `"${value}"`;
}

function schemaUrl(schema) {
  const url = new URL(directUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function redact(value, urls = []) {
  let safe = String(value ?? "");
  for (const secret of [pooledUrl, directUrl, ...urls]) safe = safe.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  return safe.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]");
}

function runNode(label, args, env, urls = []) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, urls).slice(-5000)}`);
  }
}

async function publicFingerprint(client) {
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const counts = [];
  for (const { table_name: table } of tables.rows) {
    const quoted = `"${String(table).replaceAll('"', '""')}"`;
    const count = await client.query(`SELECT count(*)::text AS count FROM public.${quoted}`);
    counts.push([table, count.rows[0]?.count ?? "0"]);
  }
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  return createHash("sha256").update(JSON.stringify({ counts, columns: columns.rows })).digest("hex");
}

async function applyPreviousMigrations(client) {
  const root = join(process.cwd(), "prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !currentMigrations.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const sql = (await readFile(join(root, name, "migration.sql"), "utf8"))
      .replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
    await client.query(sql);
  }
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: pooledIdentity.provider,
  pooledAndDirectSameTarget: true,
  connection: false,
  freshMigrations: false,
  migrateStatus: false,
  migrateDiffClean: false,
  explicitPrismaPgCanary: false,
  attendanceConcurrency: false,
  upgradeScheduleCopied: false,
  legacyScheduleColumnsRetained: false,
  legacyScheduleValuesPreserved: false,
  feeColumnsCreated: false,
  dailyMonthlyBackfill: false,
  freeFeePreserved: false,
  unsupportedLegacyFeeUntouched: false,
  schoolOwnerEnumCreated: false,
  exactLogoBackfill: false,
  ambiguousLogoRowsUntouched: false,
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

  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${ident(schema)}`);

  const freshUrl = schemaUrl(freshSchema);
  const freshEnv = { ...process.env, DATABASE_URL: freshUrl, DIRECT_DATABASE_URL: freshUrl };
  runNode("prisma migrate deploy", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], freshEnv, [freshUrl]);
  results.freshMigrations = true;
  runNode("prisma migrate status", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"], freshEnv, [freshUrl]);
  results.migrateStatus = true;
  runNode("prisma migrate diff", [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--exit-code",
  ], freshEnv, [freshUrl]);
  results.migrateDiffClean = true;

  runNode("PrismaPg settings canary", [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/school-settings-postgres.test.ts", "--maxWorkers=1",
  ], { ...process.env, DATABASE_URL: pooledUrl, SCHOOL_SETTINGS_TEST_SCHEMA: freshSchema }, [freshUrl]);
  const canary = await admin.query(
    `SELECT count(*)::int AS count FROM ${ident(freshSchema)}."School" WHERE "name" = 'Isolated settings canary'`
  );
  const publicCanary = await admin.query(
    `SELECT CASE WHEN to_regclass('public."School"') IS NULL THEN 0 ELSE
      (SELECT count(*)::int FROM public."School" WHERE "name" = 'Isolated settings canary') END AS count`
  );
  results.explicitPrismaPgCanary = canary.rows[0]?.count === 1 && publicCanary.rows[0]?.count === 0;

  runNode("attendance concurrency", [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/attendance-operations-postgres.test.ts", "--maxWorkers=1",
  ], { ...process.env, DATABASE_URL: pooledUrl, ATTENDANCE_TEST_SCHEMA: freshSchema }, [freshUrl]);
  results.attendanceConcurrency = true;

  const upgrade = new Client({ connectionString: directUrl });
  await upgrade.connect();
  try {
    await upgrade.query(`SET search_path TO ${ident(upgradeSchema)}`);
    await applyPreviousMigrations(upgrade);
    const s = ident(upgradeSchema);
    const now = new Date();
    await upgrade.query(
      `INSERT INTO ${s}."School"
       ("id", "name", "logoUrl", "teacherCheckinTime", "teacherCheckoutTime", "studentCheckinTime", "studentCheckoutTime", "updatedAt") VALUES
       ('settings_school_a', 'School A', '/api/files/schools/settings_school_a/logo.png', '07:00', '15:00', '07:30', '14:00', $1),
       ('settings_school_b', 'School B', '/api/files/schools/settings_school_b/logo.png', '16:00', '22:00', '16:30', '21:00', $1)`,
      [now]
    );
    await upgrade.query(
      `INSERT INTO ${s}."Settings" ("id", "schoolId", "dailyStudentFee", "monthlyStudentFee", "updatedAt") VALUES
       ('settings_a', 'settings_school_a', 11, 220, $1),
       ('settings_b', 'settings_school_b', 0, 0, $1)`,
      [now]
    );
    await upgrade.query(
      `INSERT INTO ${s}."Student" ("id", "name", "schoolId", "billingCycle", "cycleFee", "updatedAt") VALUES
       ('student_daily', 'Daily', 'settings_school_a', 'DAILY', NULL, $1),
       ('student_monthly', 'Monthly', 'settings_school_a', 'MONTHLY', NULL, $1),
       ('student_custom', 'Custom', 'settings_school_a', 'CUSTOM', NULL, $1),
       ('student_free', 'Free', 'settings_school_b', 'DAILY', NULL, $1)`,
      [now]
    );
    const exactKey = "schools/settings_school_a/logo.png";
    const wrongCategoryKey = "schools/settings_school_b/logo.png";
    const unrelatedKey = "schools/settings_school_a/unrelated.png";
    await upgrade.query(
      `INSERT INTO ${s}."StoredFile" ("key", "schoolId", "category", "ownerId", "contentType", "sizeBytes") VALUES
       ($1, 'settings_school_a', 'school', 'legacy', 'image/png', 1),
       ($2, 'settings_school_b', 'students', 'legacy', 'image/png', 1),
       ($3, 'settings_school_a', 'school', 'legacy', 'image/png', 1)`,
      [exactKey, wrongCategoryKey, unrelatedKey]
    );

    await upgrade.query(await readFile(join(process.cwd(), "prisma/migrations/20260902120000_school_schedule_and_subscription_fees/migration.sql"), "utf8"));
    await upgrade.query(await readFile(join(process.cwd(), "prisma/migrations/20260902121000_school_logo_ownership_backfill/migration.sql"), "utf8"));

    const schedule = await upgrade.query(
      `SELECT "teacherMorningCheckinTime", "teacherMorningCheckoutTime", "teacherEveningCheckinTime", "teacherEveningCheckoutTime",
              "studentMorningCheckinTime", "studentMorningCheckoutTime", "studentEveningCheckinTime", "studentEveningCheckoutTime",
              "teacherCheckinTime", "teacherCheckoutTime", "studentCheckinTime", "studentCheckoutTime"
       FROM ${s}."School" WHERE "id" = 'settings_school_a'`
    );
    const scheduleValues = Object.values(schedule.rows[0] ?? {});
    results.upgradeScheduleCopied = JSON.stringify(scheduleValues.slice(0, 8)) === JSON.stringify([
      "07:00", "15:00", "07:00", "15:00", "07:30", "14:00", "07:30", "14:00",
    ]);
    results.legacyScheduleValuesPreserved = JSON.stringify(scheduleValues.slice(8)) === JSON.stringify([
      "07:00", "15:00", "07:30", "14:00",
    ]);
    const oldColumns = await upgrade.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'School'
         AND column_name = ANY($2::text[])`,
      [upgradeSchema, ["teacherCheckinTime", "teacherCheckoutTime", "studentCheckinTime", "studentCheckoutTime"]]
    );
    results.legacyScheduleColumnsRetained = oldColumns.rows[0]?.count === 4;
    const feeColumns = await upgrade.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Settings'
         AND column_name = ANY($2::text[])`,
      [upgradeSchema, ["weeklyStudentFee", "yearlyStudentFee"]]
    );
    results.feeColumnsCreated = feeColumns.rows[0]?.count === 2;
    const students = await upgrade.query(
      `SELECT "id", "cycleFee"::text FROM ${s}."Student"
       WHERE "id" LIKE 'student_%' ORDER BY "id"`
    );
    const fee = (id) => students.rows.find((row) => row.id === id)?.cycleFee ?? null;
    results.dailyMonthlyBackfill = fee("student_daily") === "11.00" && fee("student_monthly") === "220.00";
    results.freeFeePreserved = fee("student_free") === "0.00";
    results.unsupportedLegacyFeeUntouched = fee("student_custom") === null;
    const enumValue = await upgrade.query(
      `SELECT count(*)::int AS count FROM pg_enum value
       JOIN pg_type type ON type.oid = value.enumtypid
       JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
       WHERE namespace.nspname = $1 AND type.typname = 'StoredFileOwnerType' AND value.enumlabel = 'SCHOOL'`,
      [upgradeSchema]
    );
    results.schoolOwnerEnumCreated = enumValue.rows[0]?.count === 1;
    const files = await upgrade.query(
      `SELECT "key", "ownerType"::text, "ownerId" FROM ${s}."StoredFile"
       WHERE "key" = ANY($1::text[])`,
      [[exactKey, wrongCategoryKey, unrelatedKey]]
    );
    const file = (key) => files.rows.find((row) => row.key === key);
    results.exactLogoBackfill = file(exactKey)?.ownerType === "SCHOOL" && file(exactKey)?.ownerId === "settings_school_a";
    results.ambiguousLogoRowsUntouched = [wrongCategoryKey, unrelatedKey].every((key) => file(key)?.ownerType === "LEGACY");
  } finally {
    await upgrade.end();
  }
} catch (error) {
  failure = error;
} finally {
  try {
    if (connected) {
      for (const schema of schemas) {
        if (!/^codex_attendance_settings_[a-z0-9_]+$/.test(schema) || schema === "public") {
          throw new Error("Refusing to drop unsafe schema");
        }
        await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
      }
      const remaining = await admin.query(
        `SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
        [schemas]
      );
      results.temporarySchemasRemoved = remaining.rows[0]?.count === 0;
      results.publicUnchanged = publicBefore === await publicFingerprint(admin);
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
  } finally {
    if (connected) await admin.end();
  }
}

if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure));
for (const [key, value] of Object.entries(results)) {
  if (key === "provider") continue;
  if (value !== true) throw new Error(`Settings PostgreSQL verification failed: ${key}`);
}
console.log(JSON.stringify(results, null, 2));
