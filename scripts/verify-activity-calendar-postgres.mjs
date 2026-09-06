import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import pg from "pg";

// Explicit opt-in; no connections when this file is imported by accident.
if (process.env.RUN_ISOLATED_ACTIVITY_CHECK !== "true") {
  throw new Error("Set RUN_ISOLATED_ACTIVITY_CHECK=true for the approved temporary-schema test");
}
const direct = new URL(process.env.DIRECT_DATABASE_URL ?? "");
const pooled = new URL(process.env.DATABASE_URL ?? "");
const identity = (url) => [url.hostname.replace("-pooler.", "."), url.pathname, url.username];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fingerprint = hash(`${direct.hostname}|${direct.pathname.slice(1)}`).slice(0, 16);
if (fingerprint !== "a29feb47bc609480" || !direct.hostname.endsWith(".neon.tech") ||
    JSON.stringify(identity(direct)) !== JSON.stringify(identity(pooled))) {
  throw new Error("Refusing an unrecognized database identity");
}
direct.searchParams.set("sslmode", "verify-full");
direct.searchParams.delete("options");
const schema = `codex_activity_verify_${Date.now()}_${randomBytes(5).toString("hex")}`;
if (!/^codex_activity_verify_[0-9]+_[a-f0-9]{10}$/.test(schema)) throw new Error("Unsafe schema");
const quoted = `"${schema}"`;
const admin = new pg.Client({ connectionString: direct.toString(), connectionTimeoutMillis:20000, query_timeout:30000 });
const results = { fingerprint, schema, migrations:0, legacyPreserved:false, schemaDiffClean:false,
  postgresTests:false, publicUnchanged:false, temporarySchemaRemoved:false };
let created = false;
let before;
let failure;
function safe(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "").replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replaceAll(decodeURIComponent(direct.password), "[REDACTED]");
}
async function publicFingerprint() {
  // Only aggregate hashes leave PostgreSQL, never application row contents.
  // pg_get_expr-backed defaults depend on search_path, so normalize it before
  // comparing metadata rather than mistaking formatting for a schema change.
  await admin.query("SET search_path TO public");
  const tables = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const items = [];
  for (const { tablename } of tables.rows) {
    const name = '"' + tablename.replaceAll('"', '""') + '"';
    const row = await admin.query(`SELECT count(*)::text n, md5(COALESCE(string_agg(h, '' ORDER BY h), '')) digest
      FROM (SELECT md5(row_to_json(t)::text) h FROM public.${name} t) rows`);
    items.push([tablename, row.rows[0]]);
  }
  const meta = await admin.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
  return hash(JSON.stringify([items,meta.rows]));
}
function run(label, args, env, timeout=180000) {
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,args,{cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timer=setTimeout(()=>child.kill(),timeout);
    child.on("error",reject);
    child.on("close", code=>{
      clearTimeout(timer);
      console.log(`${label}: ${code === 0 ? "passed" : "failed"}`);
      if (code !== 0) reject(new Error(safe(output).slice(-9000)));
      else { console.log(safe(output).slice(-2500)); resolve(); }
    });
  });
}

try {
  await admin.connect();
  before=await publicFingerprint();
  console.log("Verified approved Staging identity; captured read-only public fingerprint");
  await admin.query(`CREATE SCHEMA ${quoted}`);
  created=true;
  await admin.query(`SET search_path TO ${quoted}`);
  const resolved=await admin.query("SELECT current_schema() AS schema,current_schemas(false)::text[] AS path");
  if (resolved.rows[0].schema !== schema || resolved.rows[0].path.join(",") !== schema) throw new Error("Search path isolation failed");
  const names=(await readdir("prisma/migrations",{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  for (const name of names) {
    let sql=await readFile(join("prisma/migrations",name,"migration.sql"),"utf8");
    // Baseline is the one known schema directive; do not execute it on public.
    if (name === "00000000000000_baseline") sql=sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
    const executable=sql.replace(/--[^\n]*/g,"").replace(/\/\*[\s\S]*?\*\//g,"");
    if (/\bpublic\b|\b(?:CREATE|ALTER|DROP)\s+(?:SCHEMA|DATABASE|ROLE)|\bsearch_path\b/i.test(executable)) {
      throw new Error(`Migration requires a separate safety review: ${name}`);
    }
    if (name === "20260903120000_activity_calendar_timing_messages") {
      await admin.query(`INSERT INTO ${quoted}."School" (id,name,"updatedAt") VALUES ('activity_legacy_canary','Isolated calendar canary',now())`);
      await admin.query(`INSERT INTO ${quoted}."Activity" (id,name,"schoolId","startDate","endDate","updatedAt") VALUES ('activity_legacy_canary','Legacy','activity_legacy_canary','2026-09-01','2026-09-02',now())`);
    }
    await admin.query("BEGIN");
    try { await admin.query(sql); await admin.query("COMMIT"); }
    catch (error) { await admin.query("ROLLBACK"); throw error; }
    results.migrations++;
  }
  const legacy=await admin.query(`SELECT "allDay" IS NULL AND "startDate"='2026-09-01'::timestamp AND "endDate"='2026-09-02'::timestamp AS ok FROM ${quoted}."Activity" WHERE id='activity_legacy_canary'`);
  results.legacyPreserved=legacy.rows[0]?.ok === true;
  console.log(`Applied ${results.migrations} migrations only in temporary schema; legacy dates preserved`);
  const scoped=new URL(direct);
  scoped.searchParams.set("schema",schema);
  // Child does not inherit mail, storage, admin credentials or other test opt-ins.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC)$/i.test(key)));
  Object.assign(env,{DATABASE_URL:scoped.toString(),DIRECT_DATABASE_URL:scoped.toString(),EMAIL_DELIVERY_ENABLED:"false",
    ACTIVITY_TEST_SCHEMA:schema,ACTIVITY_TEST_EXPECTED_FINGERPRINT:fingerprint});
  // Prisma's native connector uses require + sslaccept=strict; pg uses
  // verify-full. Both require TLS and certificate/hostname validation.
  // https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql
  const cliUrl = new URL(scoped);
  cliUrl.searchParams.set("sslmode", "require");
  cliUrl.searchParams.set("sslaccept", "strict");
  const cliEnv = {...env, DATABASE_URL:cliUrl.toString(), DIRECT_DATABASE_URL:cliUrl.toString()};
  try {
    await run("Prisma schema diff",["node_modules/prisma/build/index.js","migrate","diff","--from-config-datasource","--to-schema=prisma/schema.prisma","--exit-code"],cliEnv);
    results.schemaDiffClean=true;
  } catch(error) {
    // A CLI transport failure must not prevent the independent real pg tests.
    // Keep the failed gate visible; never fall back to weaker certificate checks.
    results.schemaDiffError=safe(error.message).slice(-1000);
  }
  await run("Real activity PostgreSQL suite",["node_modules/vitest/vitest.mjs","run","tests/activity-calendar-postgres.test.ts","--maxWorkers=1"],env,240000);
  results.postgresTests=true;
} catch (error) {
  failure=error;
} finally {
  if (created) {
    try {
      await admin.query("SET search_path TO pg_catalog");
      // Drop only the exact schema created by this invocation.
      await admin.query(`DROP SCHEMA ${quoted} CASCADE`);
      const remaining=await admin.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1",[schema]);
      results.temporarySchemaRemoved=remaining.rows[0].n === 0;
    } catch (error) { failure ??= error; }
  }
  if (before) {
    try { results.publicUnchanged=before === await publicFingerprint(); }
    catch(error) { failure ??=error; }
  }
  await admin.end().catch(()=>{});
}
console.log(JSON.stringify(results,null,2));
if(failure || !results.postgresTests || !results.publicUnchanged || !results.temporarySchemaRemoved || !results.legacyPreserved || !results.schemaDiffClean) {
  if(failure) console.error(safe(failure.message ?? failure));
  process.exitCode=1;
}
