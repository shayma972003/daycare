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
    throw new Error("Refusing 6F verification: database provider is not Neon");
  }
}

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const schema = `codex_6f_push_${suffix}`;
const safeName = (value) => /^codex_6f_[a-z0-9_]+$/.test(value) && value !== "public";
if (!safeName(schema)) throw new Error("Unsafe temporary schema name");
const ident = (value) => {
  if (!safeName(value)) throw new Error("Unsafe schema identifier");
  return `"${value}"`;
};
const schemaUrl = (() => {
  const parsed = new URL(directUrl);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
})();
const applicationSchemaUrl = (() => {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
})();
const redact = (value) =>
  String(value ?? "")
    .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
    .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]")
    .replaceAll(schemaUrl, "[REDACTED_TEST_DATABASE_URL]")
    .replaceAll(applicationSchemaUrl, "[REDACTED_APPLICATION_TEST_DATABASE_URL]");
function run(label, args, env) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${redact(`${result.stdout}\n${result.stderr}`).slice(-6000)}`);
  }
}

async function publicFingerprint(client) {
  const meta = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS fingerprint
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns WHERE table_schema='public'
    ) c
  `);
  const rows = await client.query(`
    SELECT
      (SELECT count(*) FROM public."School")::int AS schools,
      (SELECT count(*) FROM public."PushNotification")::int AS pushes,
      (SELECT count(*) FROM public."DeviceToken")::int AS devices
  `);
  return { meta: meta.rows[0]?.fingerprint, rows: rows.rows[0] };
}

async function workerClaim(connectionString, leaseToken) {
  const client = new Client({ connectionString });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query(`SET search_path TO ${ident(schema)}`);
    await client.query("BEGIN");
    const selected = await client.query(`
      SELECT id FROM "PushNotification"
      WHERE status='PENDING' AND "scheduledAt"<=now() AND attempts<3
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<=now())
      ORDER BY "scheduledAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (selected.rowCount === 0) {
      await client.query("COMMIT");
      return [];
    }
    const ids = selected.rows.map(({ id }) => id);
    await client.query(
      `UPDATE "PushNotification" SET "leaseToken"=$1,"leaseExpiresAt"=now()+interval '2 minutes' WHERE id=ANY($2)`,
      [leaseToken, ids]
    );
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const admin = new Client({ connectionString: directUrl });
admin.on("error", () => undefined);
const results = {
  provider: "Neon PostgreSQL",
  connection: false,
  schema,
  explicitPrismaPgCanary: false,
  migrations: false,
  migrateStatus: false,
  migrationDriftFree: false,
  concurrentWorkersSingleClaim: false,
  leaseExpiryRecovery: false,
  retryStateConsistent: false,
  applicationQueueBehavior: false,
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

  const safeEnv = { ...process.env, DATABASE_URL: schemaUrl, DIRECT_DATABASE_URL: schemaUrl };
  run("migrate deploy", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], safeEnv);
  results.migrations = true;
  run("migrate status", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"], safeEnv);
  results.migrateStatus = true;
  run("migrate diff", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], safeEnv);
  results.migrationDriftFree = true;

  const canary = `codex6f_${suffix}`;
  run(
    "PrismaPg canary",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/push-lease-prisma-canary.test.ts"],
    { ...process.env, DATABASE_URL: baseUrl, PUSH_LEASE_SCHEMA: schema, PUSH_LEASE_CANARY: canary }
  );
  const tempCanary = await admin.query(`SELECT count(*)::int AS count FROM ${ident(schema)}."School" WHERE id=$1`, [canary]);
  const publicCanary = await admin.query(`SELECT count(*)::int AS count FROM public."School" WHERE id=$1`, [canary]);
  if (tempCanary.rows[0].count !== 1 || publicCanary.rows[0].count !== 0) throw new Error("PrismaPg canary escaped temporary schema");
  results.explicitPrismaPgCanary = true;

  const worker = new Client({ connectionString: directUrl });
  worker.on("error", () => undefined);
  await worker.connect();
  await worker.query(`SET search_path TO ${ident(schema)}`);
  await worker.query(`INSERT INTO "PushNotification" (id,"schoolId",title,body) VALUES ('6f_push_one',$1,'Title','Body')`, [canary]);
  await worker.end();

  const claims = await Promise.all([
    workerClaim(directUrl, `lease_a_${suffix}`),
    workerClaim(directUrl, `lease_b_${suffix}`),
  ]);
  const claimed = claims.flat();
  if (claimed.length !== 1 || new Set(claimed).size !== 1 || claimed[0] !== "6f_push_one") {
    throw new Error("Concurrent workers did not produce exactly one claim");
  }
  results.concurrentWorkersSingleClaim = true;

  const verify = new Client({ connectionString: directUrl });
  verify.on("error", () => undefined);
  await verify.connect();
  await verify.query(`SET search_path TO ${ident(schema)}`);
  await verify.query(`UPDATE "PushNotification" SET status='SENT',attempts=attempts+1,"sentAt"=now(),"leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE id='6f_push_one'`);
  await verify.query(`INSERT INTO "PushNotification" (id,"schoolId",title,body,"leaseToken","leaseExpiresAt") VALUES ('6f_expired',$1,'Expired','Body','dead-worker',now()-interval '1 minute')`, [canary]);
  await verify.end();

  const expired = await workerClaim(directUrl, `lease_retry_${suffix}`);
  if (expired.length !== 1 || expired[0] !== "6f_expired") throw new Error("Expired lease was not reclaimed");
  results.leaseExpiryRecovery = true;

  const retry = new Client({ connectionString: directUrl });
  retry.on("error", () => undefined);
  await retry.connect();
  await retry.query(`SET search_path TO ${ident(schema)}`);
  await retry.query(`UPDATE "PushNotification" SET attempts=attempts+1,"scheduledAt"=now()+interval '5 minutes',"leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE id='6f_expired'`);
  const state = await retry.query(`SELECT status,attempts,"leaseToken","leaseExpiresAt" FROM "PushNotification" WHERE id='6f_expired'`);
  results.retryStateConsistent = state.rows[0]?.status === "PENDING" && state.rows[0]?.attempts === 1 && state.rows[0]?.leaseToken === null && state.rows[0]?.leaseExpiresAt === null;
  await retry.end();
  run(
    "6F PostgreSQL application tests",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/push-queue-postgres.test.ts", "--maxWorkers=1"],
    { ...process.env, DATABASE_URL: applicationSchemaUrl, PUSH_LEASE_SCHEMA: schema }
  );
  results.applicationQueueBehavior = true;
} catch (error) {
  failure = error;
} finally {
  try {
    if (created) {
      if (!safeName(schema)) throw new Error("Refusing unsafe schema cleanup");
      await admin.query(`DROP SCHEMA ${ident(schema)} CASCADE`);
      const remaining = await admin.query("SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=$1", [schema]);
      results.schemaRemoved = remaining.rows[0].count === 0;
    }
    if (before) results.publicUnchanged = JSON.stringify(before) === JSON.stringify(await publicFingerprint(admin));
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  await admin.end().catch(() => undefined);
}

console.log(JSON.stringify(results, null, 2));
if (failure || !Object.values(results).every(Boolean)) {
  if (failure) console.error(redact(failure instanceof Error ? failure.message : failure));
  process.exitCode = 1;
}
