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
  if (!new URL(value).hostname.toLowerCase().includes("neon")) throw new Error("6B3A accepts Neon only");
}
const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const freshSchema = `codex_6b3a_fresh_${suffix}`;
const upgradeSchema = `codex_6b3a_upgrade_${suffix}`;
const schemas = [freshSchema, upgradeSchema];
const migrationName = "20260813194500_encrypt_enrollment_submission_id_number";
const encryptionKey = randomBytes(32).toString("base64");
const indexPepper = randomBytes(48).toString("base64");

function ident(value) {
  if (!/^codex_6b3a_[a-z0-9_]+$/.test(value) || value === "public") throw new Error("Unsafe schema");
  return `"${value}"`;
}
function schemaUrl(schema, raw = false) {
  const url = new URL(directUrl);
  url.searchParams.set("schema", schema);
  if (raw) url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}
function redact(value, urls = []) {
  let safe = String(value ?? "");
  for (const secret of [baseUrl, directUrl, ...urls, encryptionKey, indexPepper]) {
    safe = safe.replaceAll(secret, "[REDACTED]");
  }
  return safe;
}
function run(label, args, env, urls = []) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", env });
  if (result.status !== 0) throw new Error(`${label} failed:\n${redact(`${result.stdout}\n${result.stderr}`, urls).slice(-6000)}`);
}
async function fingerprint(client) {
  const metadata = await client.query(`SELECT md5(COALESCE(string_agg(table_name || ':' || column_name, ',' ORDER BY table_name, column_name), '')) AS value FROM information_schema.columns WHERE table_schema='public'`);
  const rows = await client.query(`SELECT (SELECT count(*) FROM public."EnrollmentSubmission" WHERE "id" LIKE '6b3a\_%' ESCAPE '\\')::int AS count`);
  return { metadata: metadata.rows[0]?.value, rows: rows.rows[0]?.count ?? 0 };
}
async function applyPrevious(pool) {
  const root = join(process.cwd(), "prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).filter((x) => x !== migrationName).sort();
  for (const name of names) await pool.query(await readFile(join(root, name, "migration.sql"), "utf8"));
}

const admin = new Client({ connectionString: directUrl });
const results = { provider: "Neon PostgreSQL", fresh: false, status: false, diff: false, upgrade: false, index: false, postgresTests: false, canary: false, publicUnchanged: false, schemasRemoved: false };
let before;
let failure;
try {
  await admin.connect();
  before = await fingerprint(admin);
  if (before.rows !== 0) throw new Error("Public contains 6B3A canary rows");
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${ident(schema)}`);

  const freshUrl = schemaUrl(freshSchema);
  const freshEnv = { ...process.env, DATABASE_URL: freshUrl, DIRECT_DATABASE_URL: freshUrl };
  run("migrate deploy", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], freshEnv, [freshUrl]);
  results.fresh = true;
  run("migrate status", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"], freshEnv, [freshUrl]);
  results.status = true;
  run("migrate diff", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--exit-code"], freshEnv, [freshUrl]);
  results.diff = true;

  const upgradeUrl = schemaUrl(upgradeSchema, true);
  const pool = new Pool({ connectionString: upgradeUrl, max: 6 });
  try {
    await applyPrevious(pool);
    const s = ident(upgradeSchema);
    await pool.query(`INSERT INTO ${s}."School" ("id","name","updatedAt") VALUES ('6b3a_school','School',NOW())`);
    await pool.query(`INSERT INTO ${s}."EnrollmentToken" ("id","school_id","token","expires_at") VALUES ('6b3a_token','6b3a_school','6b3a_raw',NOW()+interval '1 day')`);
    await pool.query(`INSERT INTO ${s}."EnrollmentSubmission" ("id","token_id","school_id","full_name","id_number") VALUES ('6b3a_legacy_submission','6b3a_token','6b3a_school','Legacy','1098765432')`);
    await pool.query(await readFile(join(process.cwd(), "prisma/migrations", migrationName, "migration.sql"), "utf8"));
    results.upgrade = true;
    const idx = await pool.query(`SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname=$1 AND indexname='EnrollmentSubmission_school_id_id_number_hash_idx'`, [upgradeSchema]);
    results.index = idx.rows[0]?.count === 1;
  } finally { await pool.end(); }

  run("PostgreSQL PII tests", [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/enrollment-submission-pii-postgres.test.ts"], {
    ...process.env,
    DATABASE_URL: upgradeUrl,
    ENROLLMENT_6B3A_SCHEMA: upgradeSchema,
    PII_ENCRYPTION_KEY: encryptionKey,
    PII_INDEX_PEPPER: indexPepper,
  }, [upgradeUrl]);
  results.postgresTests = true;
  const canary = await admin.query(`SELECT count(*)::int AS count FROM ${ident(upgradeSchema)}."School" WHERE "id"='6b3a_canary_school'`);
  results.canary = canary.rows[0]?.count === 1 && (await fingerprint(admin)).rows === 0;
} catch (error) { failure = error; }
finally {
  try {
    for (const schema of schemas) {
      if (!schema.startsWith("codex_6b3a_") || schema === "public") throw new Error("Unsafe drop");
      await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    }
    const left = await admin.query(`SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=ANY($1::text[])`, [schemas]);
    results.schemasRemoved = left.rows[0]?.count === 0;
    const after = await fingerprint(admin);
    results.publicUnchanged = before?.metadata === after.metadata && before?.rows === after.rows && after.rows === 0;
  } catch (error) { failure ??= error; }
  await admin.end().catch(() => undefined);
}
if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure));
for (const [key, value] of Object.entries(results)) if (key !== "provider" && value !== true) throw new Error(`6B3A failed: ${key}`);
console.log(JSON.stringify(results, null, 2));
