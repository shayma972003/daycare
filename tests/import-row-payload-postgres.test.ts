import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  backfillImportRowPayloads,
  clearedImportRowPayload,
  lockImportRow,
  protectedImportRowPayload,
  revealImportRowPayload,
} from '@/lib/import-row-payload';

const schema = process.env.IMPORT_ROW_6B3B_SCHEMA;
const connectionString = process.env.DATABASE_URL;
const run = schema && connectionString ? describe.sequential : describe.skip;
const suffix = randomBytes(4).toString('hex');
let prisma: PrismaClient;

run('ImportRow encryption on PostgreSQL', () => {
  beforeAll(async () => {
    if (!schema || !/^codex_6b3b_[a-z0-9_]+$/.test(schema) || schema === 'public') {
      throw new Error('Unsafe 6B3B schema');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }, { schema }) });
    const current = await prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
    expect(current[0]?.schema).toBe(schema);
  });

  afterAll(async () => prisma?.$disconnect());

  it('backfills and clears legacy JSON atomically, decrypts correctly, and is rerunnable', async () => {
    const sessionId = `6b3b_backfill_session_${suffix}`;
    await prisma.school.create({ data: { id: `6b3b_school_${suffix}`, name: 'Test School' } });
    await prisma.importSession.create({
      data: {
        id: sessionId,
        school_id: `6b3b_school_${suffix}`,
        type: 'students',
        total_rows: 1,
        expires_at: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.importRow.create({
      data: {
        id: `6b3b_legacy_${suffix}`,
        session_id: sessionId,
        row_number: 2,
        raw_data: { id_number: '1098765432', phone: '0500000000', email: 'legacy@example.test' },
        mapped_data: { full_name: 'Legacy Child' },
        errors: [],
        warnings: [],
      },
    });
    const result = await backfillImportRowPayloads(prisma, 10);
    expect(result.staged).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBe(0);
    const row = await prisma.importRow.findUniqueOrThrow({ where: { id: `6b3b_legacy_${suffix}` } });
    expect(row.raw_data).toBeNull();
    expect(row.mapped_data).toBeNull();
    expect(row.errors).toBeNull();
    expect(row.warnings).toBeNull();
    expect(JSON.stringify(row)).not.toContain('1098765432');
    expect(revealImportRowPayload(row)).toMatchObject({
      rawData: { id_number: '1098765432', phone: '0500000000', email: 'legacy@example.test' },
      mappedData: { full_name: 'Legacy Child' },
    });
    await expect(backfillImportRowPayloads(prisma, 10)).resolves.toEqual({ staged: 0, skipped: 0 });
  });

  it('rolls back the whole locked batch when a database write fails', async () => {
    const sessionId = `6b3b_rollback_session_${suffix}`;
    const schoolId = `6b3b_rollback_school_${suffix}`;
    const firstId = `6b3b_rollback_a_${suffix}`;
    const failingId = `6b3b_rollback_b_${suffix}`;
    await prisma.school.create({ data: { id: schoolId, name: 'Rollback School' } });
    await prisma.importSession.create({
      data: { id: sessionId, school_id: schoolId, type: 'students', total_rows: 2, expires_at: new Date(Date.now() + 86_400_000) },
    });
    await prisma.importRow.createMany({ data: [firstId, failingId].map((id, index) => ({
      id,
      session_id: sessionId,
      row_number: index + 2,
      raw_data: { id_number: `10${index}0000000` },
    })) });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "reject_6b3b_backfill_${suffix}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."id" = '${failingId}' AND NEW."encrypted_payload" IS NOT NULL THEN
          RAISE EXCEPTION 'synthetic write failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "reject_6b3b_backfill_${suffix}"
      BEFORE UPDATE ON "ImportRow"
      FOR EACH ROW EXECUTE FUNCTION "reject_6b3b_backfill_${suffix}"()`);
    await expect(backfillImportRowPayloads(prisma, 10)).rejects.toThrow();
    const rows = await prisma.importRow.findMany({ where: { id: { in: [firstId, failingId] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.encrypted_payload === null && row.raw_data !== null)).toBe(true);
    await prisma.$executeRawUnsafe(`DROP TRIGGER "reject_6b3b_backfill_${suffix}" ON "ImportRow"; DROP FUNCTION "reject_6b3b_backfill_${suffix}"()`);
  }, 30_000);

  it('rejects a tampered package even when legacy plaintext is present', async () => {
    const encrypted = protectedImportRowPayload(sensitive()).encrypted_payload;
    expect(() => revealImportRowPayload({
      encrypted_payload: `${encrypted.slice(0, -1)}x`,
      raw_data: { id_number: 'must-not-fallback' },
      mapped_data: null,
      errors: null,
      warnings: null,
    })).toThrow();
  });

  it('allows only one concurrent confirmation and clears staged data with the created record', async () => {
    const sessionId = `6b3b_confirm_session_${suffix}`;
    const schoolId = `6b3b_confirm_school_${suffix}`;
    const rowId = `6b3b_confirm_row_${suffix}`;
    await prisma.school.create({ data: { id: schoolId, name: 'Confirm School' } });
    await prisma.importSession.create({
      data: { id: sessionId, school_id: schoolId, type: 'teachers', status: 'confirming', total_rows: 1, expires_at: new Date(Date.now() + 86_400_000) },
    });
    await prisma.importRow.create({
      data: {
        id: rowId,
        session_id: sessionId,
        row_number: 2,
        status: 'valid',
        ...protectedImportRowPayload({ rawData: { name: 'Teacher' }, mappedData: { full_name: 'Teacher' }, errors: [], warnings: [] }),
      },
    });
    const confirmOnce = () => prisma.$transaction(async (tx) => {
      if (!(await lockImportRow(tx, rowId))) return false;
      const row = await tx.importRow.findFirst({ where: { id: rowId, status: 'valid' } });
      if (!row) return false;
      const payload = revealImportRowPayload(row);
      await tx.teacher.create({ data: { schoolId, name: String(payload.mappedData?.full_name) } });
      await tx.importRow.update({ where: { id: rowId }, data: { status: 'imported', ...clearedImportRowPayload() } });
      return true;
    }, { timeout: 30_000 });
    const results = await Promise.all([confirmOnce(), confirmOnce()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.teacher.count({ where: { schoolId } })).toBe(1);
    await expect(prisma.importRow.findUniqueOrThrow({ where: { id: rowId } })).resolves.toMatchObject({
      status: 'imported',
      encrypted_payload: null,
      raw_data: null,
      mapped_data: null,
    });
  });

  it('uses the session status as CAS between validation and confirmation', async () => {
    const schoolId = `6b3b_race_school_${suffix}`;
    const sessionId = `6b3b_race_session_${suffix}`;
    await prisma.school.create({ data: { id: schoolId, name: 'Race School' } });
    await prisma.importSession.create({
      data: { id: sessionId, school_id: schoolId, type: 'students', status: 'validated', expires_at: new Date(Date.now() + 86_400_000) },
    });
    const [validation, confirmation] = await Promise.all([
      prisma.importSession.updateMany({ where: { id: sessionId, status: 'validated' }, data: { status: 'validating' } }),
      prisma.importSession.updateMany({ where: { id: sessionId, status: 'validated' }, data: { status: 'confirming' } }),
    ]);
    expect(validation.count + confirmation.count).toBe(1);
  });

  it('cascades encrypted rows when an expired session is deleted', async () => {
    const schoolId = `6b3b_cascade_school_${suffix}`;
    const sessionId = `6b3b_cascade_session_${suffix}`;
    const rowId = `6b3b_cascade_row_${suffix}`;
    await prisma.school.create({ data: { id: schoolId, name: 'Cascade School' } });
    await prisma.importSession.create({ data: { id: sessionId, school_id: schoolId, type: 'students', expires_at: new Date(0) } });
    await prisma.importRow.create({ data: { id: rowId, session_id: sessionId, row_number: 2, ...protectedImportRowPayload(sensitive()) } });
    await prisma.importSession.delete({ where: { id: sessionId } });
    expect(await prisma.importRow.findUnique({ where: { id: rowId } })).toBeNull();
  });
});

function sensitive() {
  return { rawData: { id_number: '1077777777' }, mappedData: null, errors: null, warnings: null };
}
