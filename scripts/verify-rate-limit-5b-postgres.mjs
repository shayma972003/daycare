import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is not configured");
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;

for (const url of [baseUrl, directUrl]) {
  const parsed = new URL(url);
  if (!parsed.hostname.toLowerCase().includes("neon")) {
    throw new Error("Refusing 5B verification: database provider is not Neon");
  }
}

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const schema = `codex_5b_${suffix}`;
if (!/^codex_5b_[a-z0-9_]+$/.test(schema) || schema === "public") {
  throw new Error("Unsafe temporary schema name");
}

function ident(value) {
  if (!/^codex_5b_[a-z0-9_]+$/.test(value) || value === "public") {
    throw new Error("Unsafe temporary schema identifier");
  }
  return `"${value}"`;
}

function schemaUrl(value) {
  const url = new URL(directUrl);
  url.searchParams.set("schema", value);
  return url.toString();
}

function redact(value, testUrl) {
  return String(value ?? "")
    .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
    .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]")
    .replaceAll(testUrl, "[REDACTED_TEST_DATABASE_URL]");
}

function runNode(label, args, env, testUrl) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    const safe = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, testUrl).slice(-5000);
    throw new Error(`${label} failed:\n${safe}`);
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
  const migrationTable = await client.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`
  );
  let migrations = "absent";
  if (migrationTable.rows[0]?.present) {
    const result = await client.query(`
      SELECT md5(COALESCE(string_agg(
        "migration_name" || ':' || COALESCE("finished_at"::text, ''),
        ',' ORDER BY "migration_name"
      ), '')) AS fingerprint
      FROM public."_prisma_migrations"
    `);
    migrations = result.rows[0]?.fingerprint ?? "empty";
  }
  return {
    metadata: metadata.rows[0]?.fingerprint ?? "empty",
    migrations,
  };
}

async function publicTestRowCount(client) {
  const table = await client.query(`SELECT to_regclass('public."RateLimit"') IS NOT NULL AS present`);
  if (!table.rows[0]?.present) return 0;
  const result = await client.query(
    `SELECT count(*)::int AS count FROM public."RateLimit" WHERE "key" LIKE 'codex5b\\_%' ESCAPE '\\'`
  );
  return result.rows[0]?.count ?? 0;
}

const admin = new Client({ connectionString: directUrl });
const testUrl = schemaUrl(schema);
const safeEnv = {
  ...process.env,
  DATABASE_URL: testUrl,
  DIRECT_DATABASE_URL: testUrl,
};
const results = {
  provider: "Neon PostgreSQL",
  connection: "pending",
  temporarySchema: schema,
  explicitPrismaPgSchema: false,
  modelCanaryInTemporarySchema: false,
  publicCanaryAbsent: false,
  allMigrationsApplied: false,
  migrateStatusCurrent: false,
  postgresRateLimitTests: false,
  productionBuild: false,
  publicMetadataUnchanged: false,
  publicMigrationsUnchanged: false,
  publicTestRows: -1,
  temporarySchemaRemoved: false,
};

let connected = false;
let created = false;
let publicBefore;
let failure;
try {
  await admin.connect();
  connected = true;
  await admin.query("SELECT 1");
  results.connection = "ok";
  publicBefore = await publicFingerprint(admin);
  if ((await publicTestRowCount(admin)) !== 0) {
    throw new Error("public already contains a codex5b test key; refusing to continue");
  }

  await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  created = true;

  // Canary table exists only long enough to prove that generated model queries
  // honor PrismaPg's explicit schema option rather than falling back to public.
  await admin.query(`
    CREATE TABLE ${ident(schema)}."RateLimit" (
      "id" text PRIMARY KEY,
      "key" text NOT NULL UNIQUE,
      "count" integer NOT NULL DEFAULT 0,
      "expiresAt" timestamp(3) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const canaryKey = `codex5b_${suffix}:canary`;
  runNode(
    "PrismaPg model canary",
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/rate-limit-prisma-canary.test.ts",
    ],
    {
      ...process.env,
      DATABASE_URL: baseUrl,
      RATE_LIMIT_POSTGRES_SCHEMA: schema,
      RATE_LIMIT_CANARY_KEY: canaryKey,
    },
    testUrl
  );
  results.explicitPrismaPgSchema = true;
  const temporary = await admin.query(
    `SELECT count(*)::int AS count FROM ${ident(schema)}."RateLimit" WHERE "key" = $1`,
    [canaryKey]
  );
  results.modelCanaryInTemporarySchema = temporary.rows[0]?.count === 1;
  results.publicCanaryAbsent = (await publicTestRowCount(admin)) === 0;
  if (!results.modelCanaryInTemporarySchema || !results.publicCanaryAbsent) {
    throw new Error("Prisma model canary did not remain isolated from public");
  }
  await admin.query(`DROP TABLE ${ident(schema)}."RateLimit"`);

  runNode(
    "prisma migrate deploy",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    safeEnv,
    testUrl
  );
  results.allMigrationsApplied = true;
  runNode(
    "prisma migrate status",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"],
    safeEnv,
    testUrl
  );
  results.migrateStatusCurrent = true;

  runNode(
    "PostgreSQL RateLimiter integration tests",
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/rate-limit-postgres.test.ts",
    ],
    {
      ...process.env,
      DATABASE_URL: baseUrl,
      RATE_LIMIT_POSTGRES_SCHEMA: schema,
    },
    testUrl
  );
  results.postgresRateLimitTests = true;

  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  const buildScript = String(packageJson.scripts?.build ?? "");
  if (!buildScript || /migrate|seed|db\s+push/i.test(buildScript)) {
    throw new Error("Build script is missing or contains a database mutation command");
  }
  runNode(
    "prisma generate for production build",
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "generate"],
    safeEnv,
    testUrl
  );
  runNode(
    "Next.js production build",
    [join(process.cwd(), "node_modules/next/dist/bin/next"), "build"],
    { ...safeEnv, NODE_ENV: "production" },
    testUrl
  );
  results.productionBuild = true;
} catch (error) {
  failure = error;
} finally {
  try {
    if (connected && created) {
      if (!schema.startsWith("codex_5b_") || schema === "public") {
        throw new Error("Refusing to drop unsafe schema");
      }
      await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
      const remaining = await admin.query(
        `SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1`,
        [schema]
      );
      results.temporarySchemaRemoved = remaining.rows[0]?.count === 0;
    }
    if (connected) {
      results.publicTestRows = await publicTestRowCount(admin);
      if (publicBefore) {
        const publicAfter = await publicFingerprint(admin);
        results.publicMetadataUnchanged = publicBefore.metadata === publicAfter.metadata;
        results.publicMigrationsUnchanged = publicBefore.migrations === publicAfter.migrations;
      }
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
  } finally {
    if (connected) await admin.end();
  }
}

if (failure) {
  throw new Error(redact(failure instanceof Error ? failure.message : failure, testUrl));
}
for (const [key, value] of Object.entries(results)) {
  if (["provider", "connection", "temporarySchema", "publicTestRows"].includes(key)) continue;
  if (value !== true) throw new Error(`5B verification failed: ${key}`);
}
if (results.publicTestRows !== 0) throw new Error("5B test rows appeared in public");

console.log(JSON.stringify(results, null, 2));
