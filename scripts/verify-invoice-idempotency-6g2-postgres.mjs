import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const baseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
if (!baseUrl || !directUrl || ![baseUrl, directUrl].every((value) => new URL(value).hostname.includes("neon"))) throw new Error("Neon only");
const schema = `codex_6g2_invoice_${Date.now()}_${randomBytes(4).toString("hex")}`;
if (!/^codex_6g2_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema");
const ident = `"${schema}"`;
const client = new pg.Client({ connectionString: directUrl });
const result = { canary: false, migrations: false, concurrency: false, tenantScoped: false, publicUnchanged: false, schemaRemoved: false };
let failure;
let before;
const fingerprint = async () => (await client.query(`SELECT md5(COALESCE(string_agg(table_name||':'||column_name,',' ORDER BY table_name,column_name),'')) value FROM information_schema.columns WHERE table_schema='public'`)).rows[0].value;
try {
  await client.connect();
  before = await fingerprint();
  await client.query(`CREATE SCHEMA ${ident}`);
  await client.query(`SET search_path TO ${ident}`);
  for (const entry of readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
    await client.query(readFileSync(join(process.cwd(), "prisma/migrations", entry, "migration.sql"), "utf8"));
  }
  result.migrations = true;
  const test = spawnSync(process.execPath, [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/invoice-idempotency-postgres.test.ts", "--maxWorkers=1"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: baseUrl, INVOICE_IDEMPOTENCY_SCHEMA: schema } });
  if (test.status !== 0) throw new Error(test.stderr.slice(-3000));
  const tempRows = await client.query(`SELECT count(*)::int count FROM ${ident}."Invoice"`);
  const publicRows = await client.query(`SELECT count(*)::int count FROM public."Invoice" WHERE "idempotencyKey"='same-key-123'`).catch(() => ({ rows: [{ count: 0 }] }));
  result.canary = tempRows.rows[0].count === 1 && publicRows.rows[0].count === 0;
  result.concurrency = result.canary;
  await client.query(`INSERT INTO ${ident}."School" (id,name,"updatedAt") VALUES ('6g2_other','other',now())`);
  await client.query(`INSERT INTO ${ident}."Invoice" (id,"schoolId",type,amount,data,"operationKind","idempotencyKey","requestHash") VALUES ('6g2_other_invoice','6g2_other','STUDENT',0,'{}','student-custom','same-key-123','hash-a')`);
  result.tenantScoped = (await client.query(`SELECT count(*)::int count FROM ${ident}."Invoice" WHERE "idempotencyKey"='same-key-123'`)).rows[0].count === 2;
} catch (error) { failure = error; }
finally {
  if (/^codex_6g2_[a-z0-9_]+$/.test(schema)) await client.query(`DROP SCHEMA IF EXISTS ${ident} CASCADE`).catch((error) => { failure ??= error; });
  if (before) result.publicUnchanged = before === await fingerprint().catch(() => undefined);
  result.schemaRemoved = (await client.query(`SELECT count(*)::int count FROM information_schema.schemata WHERE schema_name=$1`, [schema]).catch(() => ({ rows: [{ count: -1 }] }))).rows[0].count === 0;
  await client.end().catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (failure || !Object.values(result).every(Boolean)) { if (failure) console.error(failure instanceof Error ? failure.message : failure); process.exitCode = 1; }
