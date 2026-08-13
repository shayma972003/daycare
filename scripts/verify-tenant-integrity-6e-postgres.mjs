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
for (const value of [baseUrl, directUrl]) {
  if (!new URL(value).hostname.toLowerCase().includes("neon")) {
    throw new Error("Refusing 6E verification: database provider is not Neon");
  }
}

const targets = [
  "20260813230000_account_student_tenant_integrity",
  "20260813231500_attendance_finance_tenant_integrity",
  "20260813233000_enrollment_device_tenant_integrity",
];
const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const schemas = {
  fresh: `codex_6e_fresh_${suffix}`,
  accounts: `codex_6e_accounts_${suffix}`,
  operations: `codex_6e_operations_${suffix}`,
  enrollment: `codex_6e_enrollment_${suffix}`,
};
const safeName = (value) => /^codex_6e_[a-z0-9_]+$/.test(value) && value !== "public";
const ident = (value) => {
  if (!safeName(value)) throw new Error("Unsafe temporary schema identifier");
  return `"${value}"`;
};
Object.values(schemas).forEach((value) => {
  if (!safeName(value)) throw new Error("Unsafe temporary schema name");
});

const migrationNames = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const migrationSql = new Map(
  migrationNames.map((name) => [name, readFileSync(join("prisma/migrations", name, "migration.sql"), "utf8")])
);
const schemaUrl = (schema) => {
  const parsed = new URL(directUrl);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
};
const redact = (value) =>
  String(value ?? "")
    .replaceAll(baseUrl, "[REDACTED_DATABASE_URL]")
    .replaceAll(directUrl, "[REDACTED_DIRECT_DATABASE_URL]");
function run(label, args, env) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", env });
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
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
  );
  const counts = [];
  for (const { table_name: table } of tables.rows) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("Unsafe public table name");
    const row = await client.query(`SELECT count(*)::bigint AS count FROM public."${table}"`);
    counts.push([table, row.rows[0].count]);
  }
  return { metadata: metadata.rows[0]?.fingerprint, counts };
}

async function createClient(admin, schema) {
  await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  const client = new Client({ connectionString: directUrl });
  await client.connect();
  await client.query(`SET search_path TO ${ident(schema)}`);
  const current = await client.query("SELECT current_schema() AS schema");
  if (current.rows[0]?.schema !== schema) throw new Error(`Schema routing failed for ${schema}`);
  return client;
}

async function applyBefore(client, target) {
  for (const name of migrationNames) {
    if (name === target) break;
    await client.query(migrationSql.get(name));
  }
}

async function expectMigrationConflict(client, migration, message) {
  try {
    await client.query(migrationSql.get(migration));
    throw new Error(`${migration} unexpectedly accepted conflicting data`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (!String(error.message).includes(message)) throw error;
  }
}

async function expectConstraint(client, sql, params = []) {
  try {
    await client.query(sql, params);
    throw new Error("Cross-tenant write unexpectedly succeeded");
  } catch (error) {
    if (!["23503", "23514"].includes(error.code)) throw error;
  }
}

async function seedSchools(client, prefix) {
  const a = `${prefix}_school_a`;
  const b = `${prefix}_school_b`;
  await client.query(
    `INSERT INTO "School" (id,name,"updatedAt") VALUES ($1,'School A',now()),($2,'School B',now())`,
    [a, b]
  );
  return { a, b };
}

async function verifyAccounts(admin) {
  const client = await createClient(admin, schemas.accounts);
  try {
    await applyBefore(client, targets[0]);
    const schools = await seedSchools(client, "6e_accounts");
    await client.query(
      `INSERT INTO "Role" (id,"schoolId",key,"nameAr","updatedAt") VALUES
       ('6e_role_a',$1,'manager','Manager',now()),('6e_role_b',$2,'manager','Manager',now())`,
      [schools.a, schools.b]
    );
    await client.query(
      `INSERT INTO "User" (id,name,email,password,role,"schoolId","roleId","updatedAt")
       VALUES ('6e_conflict_user','Conflict','6e-conflict@example.test',NULL,'admin',$1,'6e_role_b',now())`,
      [schools.a]
    );
    await expectMigrationConflict(client, targets[0], "User/Role tenant conflicts");
    await client.query(`DELETE FROM "User" WHERE id='6e_conflict_user'`);

    await client.query(`INSERT INTO "Class" (id,name,"schoolId","updatedAt") VALUES ('6e_class_a','A',$1,now()),('6e_class_b','B',$2,now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "Guardian" (id,"schoolId",name,"updatedAt") VALUES ('6e_guardian_a',$1,'A',now()),('6e_guardian_b',$2,'B',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "AcademicStageOption" (id,"schoolId","nameAr","updatedAt") VALUES ('6e_stage_a',$1,'Stage A',now()),('6e_stage_b',$2,'Stage B',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "Student" (id,name,"schoolId","classId","guardianId","stageId","updatedAt") VALUES ('6e_student_a','A',$1,'6e_class_a','6e_guardian_a','6e_stage_a',now()),('6e_student_b','B',$2,'6e_class_b','6e_guardian_b','6e_stage_b',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "StudentGuardian" ("studentId","guardianId") VALUES ('6e_student_a','6e_guardian_a')`);
    await client.query(migrationSql.get(targets[0]));

    await client.query(`INSERT INTO "User" (id,name,email,password,role,"schoolId","roleId","updatedAt") VALUES ('6e_user_a','A','6e-a@example.test',NULL,'admin',$1,'6e_role_a',now())`, [schools.a]);
    await expectConstraint(client, `UPDATE "User" SET "roleId"='6e_role_b' WHERE id='6e_user_a'`);
    await expectConstraint(client, `UPDATE "Student" SET "classId"='6e_class_b' WHERE id='6e_student_a'`);
    await expectConstraint(client, `UPDATE "Student" SET "guardianId"='6e_guardian_b' WHERE id='6e_student_a'`);
    await expectConstraint(client, `UPDATE "Student" SET "stageId"='6e_stage_b' WHERE id='6e_student_a'`);
    await expectConstraint(client, `INSERT INTO "StudentGuardian" ("schoolId","studentId","guardianId") VALUES ($1,'6e_student_a','6e_guardian_b')`, [schools.a]);
  } finally {
    await client.end();
  }
}

async function verifyOperations(admin) {
  const client = await createClient(admin, schemas.operations);
  try {
    await applyBefore(client, targets[1]);
    const schools = await seedSchools(client, "6e_ops");
    await client.query(`INSERT INTO "Class" (id,name,"schoolId","updatedAt") VALUES ('6e_op_class_a','A',$1,now()),('6e_op_class_b','B',$2,now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "Student" (id,name,"schoolId","classId","updatedAt") VALUES ('6e_op_student_a','A',$1,'6e_op_class_a',now()),('6e_op_student_b','B',$2,'6e_op_class_b',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "Teacher" (id,name,"schoolId","updatedAt") VALUES ('6e_op_teacher_a','A',$1,now()),('6e_op_teacher_b','B',$2,now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "CareReport" (id,"schoolId","studentId","classId","reportedByName",type,"occurredAt","updatedAt") VALUES ('6e_op_conflict',$1,'6e_op_student_a','6e_op_class_b','A','GENERAL',now(),now())`, [schools.a]);
    await expectMigrationConflict(client, targets[1], "CareReport/Class missing or tenant-conflicting references");
    await client.query(`DELETE FROM "CareReport" WHERE id='6e_op_conflict'`);
    await client.query(migrationSql.get(targets[1]));

    await expectConstraint(client, `INSERT INTO "CareReport" (id,"schoolId","studentId","reportedByName",type,"occurredAt","updatedAt") VALUES ('6e_cr_student',$1,'6e_op_student_b','A','GENERAL',now(),now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "CareReport" (id,"schoolId","studentId","classId","reportedByName",type,"occurredAt","updatedAt") VALUES ('6e_cr_class',$1,'6e_op_student_a','6e_op_class_b','A','GENERAL',now(),now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "CareReport" (id,"schoolId","studentId","teacherId","reportedByName",type,"occurredAt","updatedAt") VALUES ('6e_cr_teacher',$1,'6e_op_student_a','6e_op_teacher_b','A','GENERAL',now(),now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "Attendance" (id,"studentId","schoolId",date,"updatedAt") VALUES ('6e_att_student','6e_op_student_b',$1,'2026-08-01',now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "Attendance" (id,"studentId","classId","schoolId",date,"updatedAt") VALUES ('6e_att_class','6e_op_student_a','6e_op_class_b',$1,'2026-08-02',now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "TeacherAttendance" (id,"teacherId","schoolId",date,"updatedAt") VALUES ('6e_tatt','6e_op_teacher_b',$1,'2026-08-01',now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "Shift" (id,"schoolId","teacherId",date,"startTime","endTime","updatedAt") VALUES ('6e_shift',$1,'6e_op_teacher_b','2026-08-01','08:00','16:00',now())`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "Invoice" (id,"schoolId",type,"studentId",amount,data) VALUES ('6e_invoice_s',$1,'STUDENT','6e_op_student_b',1,'{}')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "Invoice" (id,"schoolId",type,"teacherId",amount,data) VALUES ('6e_invoice_t',$1,'TEACHER','6e_op_teacher_b',1,'{}')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "PaymentCycle" (id,school_id,student_id,due_date,amount,cycle_number) VALUES ('6e_payment',$1,'6e_op_student_b',now(),1,1)`, [schools.a]);
  } finally {
    await client.end();
  }
}

async function verifyEnrollment(admin) {
  const client = await createClient(admin, schemas.enrollment);
  try {
    await applyBefore(client, targets[2]);
    const schools = await seedSchools(client, "6e_enrollment");
    await client.query(`INSERT INTO "EnrollmentToken" (id,school_id,token,expires_at) VALUES ('6e_token_a',$1,'6e-token-a',now()+interval '1 day')`, [schools.a]);
    await client.query(`INSERT INTO "EnrollmentSubmission" (id,token_id,school_id,full_name) VALUES ('6e_submission_conflict','6e_token_a',$1,'Conflict')`, [schools.b]);
    await expectMigrationConflict(client, targets[2], "EnrollmentSubmission/Token tenant conflicts");
    await client.query(`DELETE FROM "EnrollmentSubmission" WHERE id='6e_submission_conflict'`);
    await client.query(migrationSql.get(targets[2]));

    await expectConstraint(client, `INSERT INTO "EnrollmentSubmission" (id,token_id,school_id,full_name) VALUES ('6e_submission_cross','6e_token_a',$1,'Cross')`, [schools.b]);
    await client.query(`INSERT INTO "Guardian" (id,"schoolId",name,"updatedAt") VALUES ('6e_device_guardian_a',$1,'A',now()),('6e_device_guardian_b',$2,'B',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "GuardianAccount" (id,"schoolId","guardianId",email,"updatedAt") VALUES ('6e_account_a',$1,'6e_device_guardian_a','6e-ga@example.test',now()),('6e_account_b',$2,'6e_device_guardian_b','6e-gb@example.test',now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "User" (id,name,email,password,role,"schoolId","updatedAt") VALUES ('6e_device_user_a','A','6e-ua@example.test',NULL,'admin',$1,now()),('6e_device_user_b','B','6e-ub@example.test',NULL,'admin',$2,now())`, [schools.a, schools.b]);
    await client.query(`INSERT INTO "DeviceToken" (id,"schoolId","guardianAccountId",platform,token) VALUES ('6e_device_ga',$1,'6e_account_a','WEB','6e-device-ga')`, [schools.a]);
    await client.query(`INSERT INTO "DeviceToken" (id,"schoolId","userId",platform,token) VALUES ('6e_device_ua',$1,'6e_device_user_a','WEB','6e-device-ua')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "DeviceToken" (id,"schoolId","guardianAccountId",platform,token) VALUES ('6e_device_cross_g',$1,'6e_account_b','WEB','6e-device-cross-g')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "DeviceToken" (id,"schoolId","userId",platform,token) VALUES ('6e_device_cross_u',$1,'6e_device_user_b','WEB','6e-device-cross-u')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "DeviceToken" (id,"schoolId",platform,token) VALUES ('6e_device_none',$1,'WEB','6e-device-none')`, [schools.a]);
    await expectConstraint(client, `INSERT INTO "DeviceToken" (id,"schoolId","guardianAccountId","userId",platform,token) VALUES ('6e_device_both',$1,'6e_account_a','6e_device_user_a','WEB','6e-device-both')`, [schools.a]);
    await client.query(`DELETE FROM "User" WHERE id='6e_device_user_a'`);
    const userDevice = await client.query(`SELECT count(*)::int AS count FROM "DeviceToken" WHERE id='6e_device_ua'`);
    if (userDevice.rows[0].count !== 0) throw new Error("DeviceToken user cascade failed");
    await client.query(`DELETE FROM "GuardianAccount" WHERE id='6e_account_a'`);
    const guardianDevice = await client.query(`SELECT count(*)::int AS count FROM "DeviceToken" WHERE id='6e_device_ga'`);
    if (guardianDevice.rows[0].count !== 0) throw new Error("DeviceToken guardian cascade failed");
  } finally {
    await client.end();
  }
}

const admin = new Client({ connectionString: directUrl });
const results = {
  provider: "Neon PostgreSQL",
  connection: false,
  schemas: Object.values(schemas),
  explicitPrismaPgCanary: false,
  freshMigrations: false,
  migrateStatus: false,
  migrationDriftFree: false,
  accountStudentConstraints: false,
  attendanceFinanceConstraints: false,
  enrollmentDeviceConstraints: false,
  conflictPreflights: false,
  publicUnchanged: false,
  schemasRemoved: false,
};
let before;
let failure;
try {
  await admin.connect();
  await admin.query("SELECT 1");
  results.connection = true;
  before = await publicFingerprint(admin);

  await admin.query(`CREATE SCHEMA ${ident(schemas.fresh)}`);
  const freshUrl = schemaUrl(schemas.fresh);
  const safeEnv = { ...process.env, DATABASE_URL: freshUrl, DIRECT_DATABASE_URL: freshUrl };
  run("migrate deploy", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], safeEnv);
  results.freshMigrations = true;
  run("migrate status", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status"], safeEnv);
  results.migrateStatus = true;
  run("migrate diff", [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], safeEnv);
  results.migrationDriftFree = true;

  const canary = `codex6e_${suffix}`;
  run(
    "PrismaPg canary",
    [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tests/tenant-integrity-prisma-canary.test.ts"],
    { ...process.env, DATABASE_URL: baseUrl, TENANT_INTEGRITY_SCHEMA: schemas.fresh, TENANT_INTEGRITY_CANARY: canary }
  );
  const tempCanary = await admin.query(`SELECT count(*)::int AS count FROM ${ident(schemas.fresh)}."School" WHERE id=$1`, [canary]);
  const publicCanary = await admin.query(`SELECT count(*)::int AS count FROM public."School" WHERE id=$1`, [canary]);
  if (tempCanary.rows[0].count !== 1 || publicCanary.rows[0].count !== 0) throw new Error("PrismaPg canary escaped the temporary schema");
  results.explicitPrismaPgCanary = true;

  await verifyAccounts(admin);
  results.accountStudentConstraints = true;
  await verifyOperations(admin);
  results.attendanceFinanceConstraints = true;
  await verifyEnrollment(admin);
  results.enrollmentDeviceConstraints = true;
  results.conflictPreflights = true;
} catch (error) {
  failure = error;
} finally {
  try {
    for (const schema of Object.values(schemas)) {
      if (!safeName(schema)) throw new Error("Refusing unsafe schema cleanup");
      await admin.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    }
    const remaining = await admin.query("SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name=ANY($1)", [Object.values(schemas)]);
    results.schemasRemoved = remaining.rows[0].count === 0;
    if (before) results.publicUnchanged = JSON.stringify(before) === JSON.stringify(await publicFingerprint(admin));
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  await admin.end().catch(() => undefined);
}

console.log(JSON.stringify(results, null, 2));
if (failure) {
  console.error(redact(failure instanceof Error ? failure.message : failure));
  process.exitCode = 1;
}
