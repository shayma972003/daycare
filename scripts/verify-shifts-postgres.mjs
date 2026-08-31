import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL ?? pooledUrl;
if (!pooledUrl || !directUrl) throw new Error("Database test URLs are not configured");
const pooled = new URL(pooledUrl); const direct = new URL(directUrl);
const host = (value) => value.toLowerCase().replace("-pooler.", ".");
if (!host(pooled.hostname).includes("neon") || host(pooled.hostname) !== host(direct.hostname) || pooled.pathname !== direct.pathname) throw new Error("Pooled/direct URLs do not identify one isolated Neon database");
const schema = `codex_shifts_${Date.now()}_${randomBytes(4).toString("hex")}`;
if (!/^codex_shifts_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema name");
const ident = `"${schema}"`;
const client = new pg.Client({ connectionString: directUrl });
const result = { provider: "Neon PostgreSQL", fingerprint: createHash("sha256").update(host(direct.hostname) + direct.pathname).digest("hex").slice(0, 16), canary: false, migrations: false, noDrift: false, concurrency: false, publicUnchanged: false, removed: false };
let before; let failure;
const redact = (value) => String(value ?? "").replaceAll(pooledUrl, "[REDACTED]").replaceAll(directUrl, "[REDACTED]");
async function publicFingerprint() {
  const meta = await client.query("SELECT md5(COALESCE(string_agg(table_name || ':' || column_name, ',' ORDER BY table_name, ordinal_position), '')) value FROM information_schema.columns WHERE table_schema='public'");
  const canary = await client.query("SELECT count(*)::int count FROM public.\"School\" WHERE id LIKE 'codex\\_shift\\_%' ESCAPE '\\'");
  return JSON.stringify({ meta: meta.rows[0]?.value, canary: canary.rows[0]?.count });
}
try {
  const migrations = readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
    .filter((item) => item.isDirectory()).map((item) => item.name).sort()
    .map((name) => ({ name, sql: readFileSync(join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8") }));
  const unsafeReferences = migrations.flatMap(({ name, sql }) => sql.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!/public\.|"public"|SET\s+search_path|CREATE\s+SCHEMA|DROP\s+SCHEMA/i.test(trimmed)) return [];
    if (name === "00000000000000_baseline" && trimmed === 'CREATE SCHEMA IF NOT EXISTS "public";') return [];
    return [`${name}:${index + 1}`];
  }));
  if (unsafeReferences.length) throw new Error(`Migration SQL is not isolated-schema safe: ${unsafeReferences.join(", ")}`);

  await client.connect();
  const identity = await client.query("SELECT current_database() database, current_user username");
  if (!identity.rows[0]?.database || !identity.rows[0]?.username) throw new Error("Could not verify database identity");
  before = await publicFingerprint();
  await client.query(`CREATE SCHEMA ${ident}`); await client.query(`SET search_path TO ${ident}`);
  for (const migration of migrations) {
    // The baseline's CREATE SCHEMA public is a generator artifact. Executing it
    // is unnecessary and would violate the temporary-schema boundary even
    // though public already exists, so the isolated harness omits that one line.
    const sql = migration.sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
    await client.query(sql);
  }
  result.migrations = true;
  const isolatedUrl = new URL(directUrl);
  isolatedUrl.searchParams.set("schema", schema);
  const diff = spawnSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DIRECT_DATABASE_URL: isolatedUrl.toString(), DATABASE_URL: isolatedUrl.toString() },
  });
  if (diff.status !== 0) throw new Error("Prisma migration drift check failed: " + redact(diff.stdout + "\n" + diff.stderr).slice(-4000));
  result.noDrift = true;
  const test = spawnSync(process.execPath, [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/shifts-postgres.test.ts", "--maxWorkers=1"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: pooledUrl, SHIFT_TEST_SCHEMA: schema, EMAIL_DELIVERY_ENABLED: "false" },
  });
  if (test.status !== 0) throw new Error("Shift PostgreSQL test failed: " + redact(test.stdout + "\n" + test.stderr).slice(-6000));
  result.concurrency = true;
  const isolated = await client.query(`SELECT count(*)::int count FROM ${ident}."Shift" WHERE "schoolId" LIKE 'codex_shift_school_%'`);
  const publicCanary = JSON.parse(await publicFingerprint()).canary;
  result.canary = isolated.rows[0]?.count > 0 && publicCanary === 0;
} catch (error) { failure = error; }
finally {
  if (/^codex_shifts_[a-z0-9_]+$/.test(schema) && schema !== "public") await client.query(`DROP SCHEMA IF EXISTS ${ident} CASCADE`).catch((error) => { failure ??= error; });
  if (before) result.publicUnchanged = before === await publicFingerprint().catch(() => undefined);
  result.removed = (await client.query("SELECT count(*)::int count FROM information_schema.schemata WHERE schema_name=$1", [schema]).catch(() => ({ rows: [{ count: -1 }] }))).rows[0]?.count === 0;
  await client.end().catch(() => undefined);
}
const complete = [result.canary, result.migrations, result.noDrift, result.concurrency, result.publicUnchanged, result.removed].every(Boolean);
const report = { ...result, ...(failure ? { failure: redact(failure instanceof Error ? failure.message : failure) } : {}) };
console.log(JSON.stringify(report, null, 2));
if (failure || !complete) { if (failure) console.error(redact(failure instanceof Error ? failure.message : failure)); process.exitCode = 1; }
