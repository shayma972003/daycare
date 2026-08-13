import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is not configured");
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
for (const value of [baseUrl, directUrl]) {
  if (!new URL(value).hostname.toLowerCase().includes("neon")) {
    throw new Error("Refusing 6B2 verification: provider is not Neon");
  }
}

const schema = `codex_6b2_${Date.now()}_${randomBytes(4).toString("hex")}`;
function ident(value) {
  if (!/^codex_6b2_[a-z0-9_]+$/.test(value) || value === "public") {
    throw new Error("Unsafe 6B2 schema identifier");
  }
  return `"${value}"`;
}

function schemaUrl() {
  const url = new URL(directUrl);
  url.searchParams.set("schema", schema);
  // Prisma model queries use the explicit adapter schema in the test. The
  // enrollment CAS/row lock deliberately use raw SQL, which follows the
  // connection search_path, so the isolated connection must route both.
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function redact(value, temporaryUrl = "") {
  let safe = String(value ?? "");
  for (const secret of [baseUrl, directUrl, temporaryUrl]) {
    if (secret) safe = safe.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  }
  return safe;
}

function runNode(label, args, env, temporaryUrl) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed:\n${redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, temporaryUrl).slice(-7000)}`
    );
  }
}

async function publicFingerprint(client) {
  const metadata = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS fingerprint
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ) AS columns
  `);
  const canary = await client.query(`
    SELECT
      (SELECT count(*) FROM public."School" WHERE "id" LIKE '6b2\_%' ESCAPE '\\')::int
      + (SELECT count(*) FROM public."EnrollmentToken" WHERE "id" LIKE '6b2\_%' ESCAPE '\\')::int
      + (SELECT count(*) FROM public."EnrollmentSubmission" WHERE "id" LIKE '6b2\_%' ESCAPE '\\')::int
      + (SELECT count(*) FROM public."StoredFile" WHERE "key" LIKE 'schools/6b2\_%' ESCAPE '\\')::int
      AS count
  `);
  return {
    metadata: metadata.rows[0]?.fingerprint ?? "empty",
    canaryCount: canary.rows[0]?.count ?? 0,
  };
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: "Neon PostgreSQL",
  connected: false,
  schemaCreated: false,
  migrationsApplied: false,
  migrateStatusCurrent: false,
  migrateDiffClean: false,
  explicitPrismaPgSchemaCanary: false,
  atomicTestsPassed: false,
  publicUnchanged: false,
  temporarySchemaRemoved: false,
};
let connected = false;
let publicBefore;
let failure;
const temporaryUrl = schemaUrl();

try {
  await admin.connect();
  connected = true;
  await admin.query("SELECT 1");
  results.connected = true;
  publicBefore = await publicFingerprint(admin);
  if (publicBefore.canaryCount !== 0) {
    throw new Error("Public contains a 6B2 canary; refusing to continue");
  }

  await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  results.schemaCreated = true;
  const env = { ...process.env, DATABASE_URL: temporaryUrl, DIRECT_DATABASE_URL: temporaryUrl };
  runNode(
    "prisma migrate deploy",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    env,
    temporaryUrl
  );
  results.migrationsApplied = true;
  runNode(
    "prisma migrate status",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"],
    env,
    temporaryUrl
  );
  results.migrateStatusCurrent = true;
  runNode(
    "prisma migrate diff",
    [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--exit-code",
    ],
    env,
    temporaryUrl
  );
  results.migrateDiffClean = true;

  runNode(
    "6B2 PostgreSQL tests",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/enrollment-atomic-postgres.test.ts"],
    { ...env, ENROLLMENT_6B2_SCHEMA: schema },
    temporaryUrl
  );
  results.atomicTestsPassed = true;
  const canary = await admin.query(
    `SELECT count(*)::int AS count FROM ${ident(schema)}."School" WHERE "id" LIKE '6b2\_%' ESCAPE '\\'`
  );
  results.explicitPrismaPgSchemaCanary =
    (canary.rows[0]?.count ?? 0) >= 2 && (await publicFingerprint(admin)).canaryCount === 0;
} catch (error) {
  failure = error;
} finally {
  try {
    if (connected) {
      if (!schema.startsWith("codex_6b2_") || schema === "public") {
        throw new Error("Refusing to drop unsafe schema");
      }
      await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
      const remaining = await admin.query(
        "SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1",
        [schema]
      );
      results.temporarySchemaRemoved = remaining.rows[0]?.count === 0;
      const publicAfter = await publicFingerprint(admin);
      results.publicUnchanged =
        publicBefore?.metadata === publicAfter.metadata &&
        publicBefore?.canaryCount === publicAfter.canaryCount &&
        publicAfter.canaryCount === 0;
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
  } finally {
    if (connected) await admin.end();
  }
}

if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure, temporaryUrl));
for (const [key, value] of Object.entries(results)) {
  if (key === "provider") continue;
  if (value !== true) throw new Error(`6B2 verification failed: ${key}`);
}
console.log(JSON.stringify(results, null, 2));
