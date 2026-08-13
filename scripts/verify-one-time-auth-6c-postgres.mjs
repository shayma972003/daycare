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
    throw new Error("Refusing 6C verification: database provider is not Neon");
  }
}

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const schema = `codex_6c_${suffix}`;
const safeName = (value) => /^codex_6c_[a-z0-9_]+$/.test(value) && value !== "public";
if (!safeName(schema)) throw new Error("Unsafe temporary schema name");
const ident = (value) => {
  if (!safeName(value)) throw new Error("Unsafe temporary schema identifier");
  return `"${value}"`;
};
const schemaUrl = (value) => {
  const parsed = new URL(directUrl);
  parsed.searchParams.set("schema", value);
  return parsed.toString();
};
const testUrl = schemaUrl(schema);

function redact(value) {
  return String(value ?? "")
    .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
    .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]")
    .replaceAll(testUrl, "[REDACTED_TEST_DATABASE_URL]");
}

function run(label, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${redact(`${result.stdout}\n${result.stderr}`).slice(-6000)}`);
  }
}

async function publicFingerprint(client) {
  const metadata = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS fingerprint
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns WHERE table_schema = 'public'
    ) AS columns
  `);
  const rows = await client.query(`
    SELECT
      (SELECT count(*) FROM public."School")::int AS schools,
      (SELECT count(*) FROM public."User")::int AS users,
      (SELECT count(*) FROM public."TwoFASession")::int AS twofa,
      (SELECT count(*) FROM public."PasswordResetToken")::int AS resets,
      (SELECT count(*) FROM public."EnrollmentToken")::int AS enrollments
  `);
  return { metadata: metadata.rows[0]?.fingerprint, rows: rows.rows[0] };
}

const admin = new Client({ connectionString: directUrl });
const safeEnv = {
  ...process.env,
  DATABASE_URL: testUrl,
  DIRECT_DATABASE_URL: testUrl,
  OTP_HASH_PEPPER: process.env.OTP_HASH_PEPPER ?? randomBytes(48).toString("base64url"),
};
const results = {
  provider: "Neon PostgreSQL",
  connection: false,
  schema,
  explicitPrismaPgCanary: false,
  migrations: false,
  migrateStatus: false,
  migrationDriftFree: false,
  concurrent2FA: false,
  concurrentBypass: false,
  concurrentEnrollmentOtp: false,
  concurrentPasswordReset: false,
  rollback: false,
  publicUnchanged: false,
  schemaRemoved: false,
};
let created = false;
let before;
let failure;

try {
  await admin.connect();
  await admin.query("SELECT 1");
  results.connection = true;
  before = await publicFingerprint(admin);
  await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  created = true;

  await admin.query(`
    CREATE TABLE ${ident(schema)}."RateLimit" (
      "id" text PRIMARY KEY,
      "key" text NOT NULL UNIQUE,
      "count" integer NOT NULL DEFAULT 0,
      "expiresAt" timestamp(3) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const canary = `codex6c_${suffix}_canary`;
  run(
    "PrismaPg canary",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/one-time-auth-prisma-canary.test.ts"],
    { ...safeEnv, DATABASE_URL: baseUrl, ONE_TIME_AUTH_SCHEMA: schema, ONE_TIME_AUTH_CANARY: canary }
  );
  const tempCanary = await admin.query(
    `SELECT count(*)::int AS count FROM ${ident(schema)}."RateLimit" WHERE "key" = $1`,
    [canary]
  );
  const publicCanary = await admin.query(
    `SELECT count(*)::int AS count FROM public."RateLimit" WHERE "key" = $1`,
    [canary]
  );
  if (tempCanary.rows[0]?.count !== 1 || publicCanary.rows[0]?.count !== 0) {
    throw new Error("PrismaPg canary escaped the temporary schema");
  }
  results.explicitPrismaPgCanary = true;
  await admin.query(`DROP TABLE ${ident(schema)}."RateLimit"`);

  run("migrate deploy", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], safeEnv);
  results.migrations = true;
  run("migrate status", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"], safeEnv);
  results.migrateStatus = true;
  run(
    "migrate diff",
    [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    safeEnv
  );
  results.migrationDriftFree = true;
  run(
    "6C PostgreSQL tests",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/one-time-auth-postgres.test.ts"],
    { ...safeEnv, DATABASE_URL: baseUrl, ONE_TIME_AUTH_SCHEMA: schema }
  );
  results.concurrent2FA = true;
  results.concurrentBypass = true;
  results.concurrentEnrollmentOtp = true;
  results.concurrentPasswordReset = true;
  results.rollback = true;
} catch (error) {
  failure = error;
} finally {
  try {
    if (created) {
      if (!safeName(schema)) throw new Error("Refusing unsafe schema cleanup");
      await admin.query(`DROP SCHEMA ${ident(schema)} CASCADE`);
      const remaining = await admin.query(
        "SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1",
        [schema]
      );
      results.schemaRemoved = remaining.rows[0]?.count === 0;
    }
    if (before) {
      results.publicUnchanged = JSON.stringify(before) === JSON.stringify(await publicFingerprint(admin));
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  await admin.end().catch(() => undefined);
}

console.log(JSON.stringify(results, null, 2));
if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure));
if (!Object.entries(results).filter(([key]) => key !== "provider" && key !== "schema").every(([, value]) => value === true)) {
  throw new Error("6C verification did not satisfy every invariant");
}
