import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const baseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
if (!baseUrl || !directUrl) throw new Error("Database test URLs are not configured");
for (const value of [baseUrl, directUrl]) {
  if (!new URL(value).hostname.toLowerCase().includes("neon")) {
    throw new Error("Attendance verification accepts Neon test infrastructure only");
  }
}
const pooled = new URL(baseUrl);
const direct = new URL(directUrl);
const normalizedHost = (host) => host.toLowerCase().replace("-pooler.", ".");
if (normalizedHost(pooled.hostname) !== normalizedHost(direct.hostname) || pooled.pathname !== direct.pathname) {
  throw new Error("Pooled and direct URLs do not identify the same Neon database");
}
const identityFingerprint = createHash("sha256")
  .update(normalizedHost(direct.hostname) + direct.pathname)
  .digest("hex")
  .slice(0, 16);

const suffix = Date.now() + "_" + randomBytes(4).toString("hex");
const schema = "codex_attendance_" + suffix;
if (!/^codex_attendance_[a-z0-9_]+$/.test(schema) || schema === "public") {
  throw new Error("Unsafe temporary schema name");
}
const ident = '"' + schema + '"';
const client = new pg.Client({ connectionString: directUrl });
const result = {
  provider: "Neon PostgreSQL",
  identityFingerprint,
  explicitSchemaCanary: false,
  migrations: false,
  concurrency: false,
  publicUnchanged: false,
  schemaRemoved: false,
};
let publicBefore;
let failure;

function safeOutput(value) {
  return String(value ?? "")
    .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
    .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]");
}

async function fingerprintPublic() {
  const metadata = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS value
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ) AS items
  `);
  const rows = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public."School" WHERE id LIKE 'codex\\_attendance\\_%' ESCAPE '\\') AS schools,
      (SELECT count(*)::int FROM public."Student" WHERE id LIKE 'codex\\_attendance\\_%' ESCAPE '\\') AS students,
      (SELECT count(*)::int FROM public."Teacher" WHERE id LIKE 'codex\\_attendance\\_%' ESCAPE '\\') AS teachers
  `);
  return JSON.stringify({ metadata: metadata.rows[0]?.value, rows: rows.rows[0] });
}

try {
  await client.connect();
  publicBefore = await fingerprintPublic();
  await client.query("CREATE SCHEMA " + ident);
  await client.query("SET search_path TO " + ident);

  for (const entry of readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort()) {
    await client.query(readFileSync(join(process.cwd(), "prisma/migrations", entry, "migration.sql"), "utf8"));
  }
  result.migrations = true;

  const testEnv = {
    ...process.env,
    DATABASE_URL: baseUrl,
    ATTENDANCE_TEST_SCHEMA: schema,
    EMAIL_DELIVERY_ENABLED: "false",
  };
  const test = spawnSync(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"),
    "run",
    "tests/attendance-operations-postgres.test.ts",
    "--maxWorkers=1",
  ], { cwd: process.cwd(), env: testEnv, encoding: "utf8" });
  if (test.status !== 0) {
    throw new Error("Isolated attendance test failed: " + safeOutput(test.stdout + "\n" + test.stderr).slice(-5000));
  }
  result.concurrency = true;

  const canary = await client.query(
    "SELECT count(*)::int AS count FROM " + ident + ".\"School\" WHERE id LIKE 'codex\\_attendance\\_%' ESCAPE '\\'"
  );
  const publicCanary = JSON.parse(await fingerprintPublic()).rows;
  result.explicitSchemaCanary =
    canary.rows[0]?.count === 2 &&
    publicCanary.schools === 0 &&
    publicCanary.students === 0 &&
    publicCanary.teachers === 0;
} catch (error) {
  failure = error;
} finally {
  if (/^codex_attendance_[a-z0-9_]+$/.test(schema) && schema !== "public") {
    await client.query("DROP SCHEMA IF EXISTS " + ident + " CASCADE").catch((error) => {
      failure ??= error;
    });
  }
  if (publicBefore) {
    result.publicUnchanged = publicBefore === await fingerprintPublic().catch(() => undefined);
  }
  result.schemaRemoved = (await client.query(
    "SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=$1",
    [schema]
  ).catch(() => ({ rows: [{ count: -1 }] }))).rows[0]?.count === 0;
  await client.end().catch(() => undefined);
}

console.log(JSON.stringify(result, null, 2));
if (failure || !Object.values(result).every(Boolean)) {
  if (failure) console.error(safeOutput(failure instanceof Error ? failure.message : failure));
  process.exitCode = 1;
}
