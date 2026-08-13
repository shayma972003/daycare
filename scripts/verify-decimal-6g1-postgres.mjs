import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is not configured");
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
if (![baseUrl, directUrl].every((value) => new URL(value).hostname.toLowerCase().includes("neon"))) {
  throw new Error("Refusing 6G1 verification: provider is not Neon");
}
const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const schemas = [`codex_6g1_empty_${suffix}`, `codex_6g1_upgrade_${suffix}`];
const safe = (value) => /^codex_6g1_[a-z0-9_]+$/.test(value) && value !== "public";
const ident = (value) => {
  if (!safe(value)) throw new Error("Unsafe temporary schema name");
  return `"${value}"`;
};
const migrations = readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const decimalMigration = "20260814001000_decimal_financial_values";
async function fingerprint(client) {
  const meta = await client.query(`SELECT md5(COALESCE(string_agg(table_name || ':' || column_name || ':' || data_type, ',' ORDER BY table_name,column_name),'')) AS value FROM information_schema.columns WHERE table_schema='public'`);
  const rows = await client.query(`SELECT (SELECT count(*) FROM public."School")::int AS schools,(SELECT count(*) FROM public."Invoice")::int AS invoices`);
  return { meta: meta.rows[0].value, rows: rows.rows[0] };
}
async function apply(client, schema, names) {
  await client.query(`SET search_path TO ${ident(schema)}`);
  for (const name of names) {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8");
    await client.query(sql);
  }
}

const admin = new Client({ connectionString: directUrl });
const results = { provider: "Neon PostgreSQL", explicitPrismaPgCanary: false, emptyDatabase: false, upgradePath: false, precision: false, invalidDataRejected: false, publicUnchanged: false, schemasRemoved: false };
let before;
let failure;
try {
  await admin.connect();
  before = await fingerprint(admin);
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${ident(schema)}`);

  const canaryId = `codex6g1_${suffix}`;
  await apply(admin, schemas[0], migrations);
  const canary = spawnSync(process.execPath, [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/decimal-prisma-canary.test.ts"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: baseUrl, DECIMAL_TEST_SCHEMA: schemas[0], DECIMAL_TEST_CANARY: canaryId },
  });
  if (canary.status !== 0) throw new Error(`PrismaPg canary failed: ${canary.stderr.slice(-2000)}`);
  const escaped = await admin.query(`SELECT count(*)::int AS count FROM public."School" WHERE id=$1`, [canaryId]);
  const local = await admin.query(`SELECT count(*)::int AS count FROM ${ident(schemas[0])}."School" WHERE id=$1`, [canaryId]);
  results.explicitPrismaPgCanary = local.rows[0].count === 1 && escaped.rows[0].count === 0;
  const emptyColumn = await admin.query(`SELECT data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=$1 AND table_name='Invoice' AND column_name='amount'`, [schemas[0]]);
  results.emptyDatabase = emptyColumn.rows[0]?.data_type === "numeric" && emptyColumn.rows[0]?.numeric_precision === 18 && emptyColumn.rows[0]?.numeric_scale === 2;

  const beforeDecimal = migrations.filter((name) => name < decimalMigration);
  await apply(admin, schemas[1], beforeDecimal);
  await admin.query(`SET search_path TO ${ident(schemas[1])}`);
  await admin.query(`INSERT INTO "SubscriptionPlan" (id,name,price,"max_students","max_classes","max_storage_mb",updated_at) VALUES ('6g1_plan','test',0.1+0.2,1,1,1,now()),('6g1_bad','bad','Infinity',1,1,1,now())`);
  const sql = readFileSync(join(process.cwd(), "prisma/migrations", decimalMigration, "migration.sql"), "utf8");
  try {
    await admin.query(sql);
  } catch (error) {
    results.invalidDataRejected = String(error?.message ?? error).includes("Financial Decimal conversion rejected");
    await admin.query("ROLLBACK");
  }
  await admin.query(`DELETE FROM "SubscriptionPlan" WHERE id='6g1_bad'`);
  await admin.query(sql);
  const upgraded = await admin.query(`SELECT price::text AS price FROM "SubscriptionPlan" WHERE id='6g1_plan'`);
  const upgradedColumn = await admin.query(`SELECT data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=$1 AND table_name='SubscriptionPlan' AND column_name='price'`, [schemas[1]]);
  results.precision = upgraded.rows[0]?.price === "0.30" && upgradedColumn.rows[0]?.numeric_precision === 18 && upgradedColumn.rows[0]?.numeric_scale === 2;
  results.upgradePath = results.precision;
} catch (error) {
  failure = error;
} finally {
  for (const schema of schemas) {
    if (safe(schema)) await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`).catch((error) => { failure ??= error; });
  }
  if (before) results.publicUnchanged = JSON.stringify(before) === JSON.stringify(await fingerprint(admin).catch(() => undefined));
  const remaining = await admin.query(`SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=ANY($1)`, [schemas]).catch(() => ({ rows: [{ count: -1 }] }));
  results.schemasRemoved = remaining.rows[0].count === 0;
  await admin.end().catch(() => undefined);
}
console.log(JSON.stringify(results, null, 2));
if (failure || !Object.values(results).every(Boolean)) {
  if (failure) console.error(failure instanceof Error ? failure.message : failure);
  process.exitCode = 1;
}
