import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client, Pool } = pg;
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is not configured');
const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
for (const value of [baseUrl, directUrl]) {
  if (!new URL(value).hostname.toLowerCase().includes('neon')) {
    throw new Error('6B3B verification accepts Neon only');
  }
}

const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
const freshSchema = `codex_6b3b_fresh_${suffix}`;
const upgradeSchema = `codex_6b3b_upgrade_${suffix}`;
const schemas = [freshSchema, upgradeSchema];
const migrationName = '20260813213000_encrypt_import_row_payload';
const encryptionKey = randomBytes(32).toString('base64');
const indexPepper = randomBytes(48).toString('base64');

function ident(value) {
  if (!/^codex_6b3b_[a-z0-9_]+$/.test(value) || value === 'public') {
    throw new Error('Unsafe 6B3B schema identifier');
  }
  return `"${value}"`;
}

function schemaUrl(schema) {
  const url = new URL(directUrl);
  url.searchParams.set('schema', schema);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

function redact(value, urls = []) {
  let safe = String(value ?? '');
  for (const secret of [baseUrl, directUrl, ...urls, encryptionKey, indexPepper]) {
    if (secret) safe = safe.replaceAll(secret, '[REDACTED]');
  }
  return safe;
}

function run(label, args, env, urls = []) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', env });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${redact(`${result.stdout}\n${result.stderr}`, urls).slice(-7000)}`);
  }
}

async function publicFingerprint(client) {
  const metadata = await client.query(`
    SELECT md5(COALESCE(string_agg(item, ',' ORDER BY item), '')) AS value
    FROM (
      SELECT table_name || ':' || column_name || ':' || data_type || ':' || is_nullable AS item
      FROM information_schema.columns WHERE table_schema='public'
    ) AS columns
  `);
  const canary = await client.query(`
    SELECT (SELECT count(*) FROM public."ImportRow" WHERE "id" LIKE '6b3b\_%' ESCAPE '\\')::int AS count
  `);
  return { metadata: metadata.rows[0]?.value, count: canary.rows[0]?.count ?? 0 };
}

async function applyPrevious(pool) {
  const root = join(process.cwd(), 'prisma/migrations');
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== migrationName)
    .sort();
  for (const name of names) {
    await pool.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
  }
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: 'Neon PostgreSQL',
  freshMigrations: false,
  migrateStatus: false,
  migrateDiff: false,
  upgradeMigration: false,
  backfillTool: false,
  explicitSchemaCanary: false,
  backfillAndConcurrency: false,
  publicUnchanged: false,
  schemasRemoved: false,
};
let before;
let failure;
try {
  await admin.connect();
  before = await publicFingerprint(admin);
  if (before.count !== 0) throw new Error('Public contains a 6B3B canary row');
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${ident(schema)}`);

  const freshUrl = schemaUrl(freshSchema);
  const freshEnv = { ...process.env, DATABASE_URL: freshUrl, DIRECT_DATABASE_URL: freshUrl };
  run('migrate deploy', [join(process.cwd(), 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], freshEnv, [freshUrl]);
  results.freshMigrations = true;
  run('migrate status', [join(process.cwd(), 'node_modules/prisma/build/index.js'), 'migrate', 'status'], freshEnv, [freshUrl]);
  results.migrateStatus = true;
  run('migrate diff', [join(process.cwd(), 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-config-datasource', '--to-schema=prisma/schema.prisma', '--exit-code'], freshEnv, [freshUrl]);
  results.migrateDiff = true;

  const upgradeUrl = schemaUrl(upgradeSchema);
  const pool = new Pool({ connectionString: upgradeUrl, max: 6 });
  try {
    await applyPrevious(pool);
    const schemaName = ident(upgradeSchema);
    await pool.query(`INSERT INTO ${schemaName}."School" ("id","name","updatedAt") VALUES ('6b3b_upgrade_school','Upgrade School',NOW())`);
    await pool.query(`INSERT INTO ${schemaName}."ImportSession" ("id","school_id","type","total_rows","expires_at") VALUES ('6b3b_upgrade_session','6b3b_upgrade_school','students',1,NOW()+interval '1 day')`);
    await pool.query(`INSERT INTO ${schemaName}."ImportRow" ("id","session_id","row_number","raw_data","mapped_data","errors","warnings") VALUES ('6b3b_upgrade_row','6b3b_upgrade_session',2,'{"id_number":"1098765432","phone":"0500000000","email":"legacy@example.test"}'::jsonb,'{"full_name":"Legacy Child"}'::jsonb,'[]'::jsonb,'[]'::jsonb)`);
    await pool.query(await readFile(join(process.cwd(), 'prisma/migrations', migrationName, 'migration.sql'), 'utf8'));
    const columns = await pool.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='ImportRow' AND column_name IN ('encrypted_payload','raw_data')`, [upgradeSchema]);
    results.upgradeMigration = columns.rows.some((row) => row.column_name === 'encrypted_payload')
      && columns.rows.some((row) => row.column_name === 'raw_data' && row.is_nullable === 'YES');
  } finally {
    await pool.end();
  }

  run('backfill tool', [join(process.cwd(), 'node_modules/jiti/lib/jiti-cli.mjs'), 'scripts/backfill-import-row-payloads.ts'], {
    ...process.env,
    DATABASE_URL: upgradeUrl,
    IMPORT_ROW_BACKFILL_SCHEMA: upgradeSchema,
    CONFIRM_IMPORT_ROW_BACKFILL_SCHEMA: upgradeSchema,
    PII_ENCRYPTION_KEY: encryptionKey,
    PII_INDEX_PEPPER: indexPepper,
  }, [upgradeUrl]);
  results.backfillTool = true;

  run('6B3B PostgreSQL tests', [join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run', 'tests/import-row-payload-postgres.test.ts'], {
    ...process.env,
    DATABASE_URL: upgradeUrl,
    IMPORT_ROW_6B3B_SCHEMA: upgradeSchema,
    PII_ENCRYPTION_KEY: encryptionKey,
    PII_INDEX_PEPPER: indexPepper,
  }, [upgradeUrl]);
  results.backfillAndConcurrency = true;
  const canary = await admin.query(`SELECT count(*)::int AS count FROM ${ident(upgradeSchema)}."ImportRow" WHERE "id" LIKE '6b3b\_%' ESCAPE '\\'`);
  results.explicitSchemaCanary = (canary.rows[0]?.count ?? 0) > 0 && (await publicFingerprint(admin)).count === 0;
} catch (error) {
  failure = error;
} finally {
  try {
    for (const schema of schemas) {
      if (!schema.startsWith('codex_6b3b_') || schema === 'public') throw new Error('Unsafe schema drop');
      await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    }
    const remaining = await admin.query('SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=ANY($1::text[])', [schemas]);
    results.schemasRemoved = remaining.rows[0]?.count === 0;
    const after = await publicFingerprint(admin);
    results.publicUnchanged = before?.metadata === after.metadata && before?.count === after.count && after.count === 0;
  } catch (error) {
    failure ??= error;
  }
  await admin.end().catch(() => undefined);
}

if (failure) throw new Error(redact(failure instanceof Error ? failure.message : failure));
for (const [key, value] of Object.entries(results)) {
  if (key !== 'provider' && value !== true) throw new Error(`6B3B verification failed: ${key}`);
}
console.log(JSON.stringify(results, null, 2));
