import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backfillImportRowPayloads,
  encryptImportRowPayload,
  ImportRowPayloadError,
  protectedImportRowPayload,
  revealImportRowPayload,
  updateImportRowPayload,
} from '@/lib/import-row-payload';
import { validateImportRow } from '@/lib/import-row-validation';

const originalKey = process.env.PII_ENCRYPTION_KEY;
const originalPepper = process.env.PII_INDEX_PEPPER;

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString('base64');
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalKey;
  if (originalPepper === undefined) delete process.env.PII_INDEX_PEPPER;
  else process.env.PII_INDEX_PEPPER = originalPepper;
});

const sensitivePayload = {
  rawData: {
    name: 'Test Child',
    national_id: '1098765432',
    phone: '0500000000',
    email: 'child@example.test',
  },
  mappedData: null,
  errors: null,
  warnings: null,
};

describe('encrypted import row payload', () => {
  it('round-trips one authenticated package without exposing plaintext in its write shape', () => {
    const first = protectedImportRowPayload(sensitivePayload);
    const second = protectedImportRowPayload(sensitivePayload);
    expect(first.encrypted_payload).not.toBe(second.encrypted_payload);
    expect(JSON.stringify(first)).not.toContain('1098765432');
    expect(revealImportRowPayload({
      ...first,
      raw_data: null,
      mapped_data: null,
      errors: null,
      warnings: null,
    })).toEqual(sensitivePayload);
  });

  it('rejects tampered ciphertext and never falls back to populated legacy columns', () => {
    const encrypted = encryptImportRowPayload(sensitivePayload);
    expect(() => revealImportRowPayload({
      encrypted_payload: `${encrypted.slice(0, -1)}x`,
      raw_data: { national_id: 'must-not-fallback' },
      mapped_data: null,
      errors: null,
      warnings: null,
    })).toThrow(ImportRowPayloadError);
  });

  it('reads legacy rows only when ciphertext is absent and preserves fields on partial update', () => {
    const legacy = revealImportRowPayload({
      encrypted_payload: null,
      raw_data: sensitivePayload.rawData,
      mapped_data: { full_name: 'Test Child' },
      errors: null,
      warnings: [{ field: 'email', message: 'البريد الإلكتروني غير صحيح', type: 'warning' }],
    });
    expect(updateImportRowPayload(legacy, { errors: [] })).toEqual({
      ...legacy,
      errors: [],
    });
  });

  it('fails closed before backfill without valid keys', async () => {
    delete process.env.PII_ENCRYPTION_KEY;
    const transaction = vi.fn();
    await expect(backfillImportRowPayloads({ $transaction: transaction } as never))
      .rejects.toBeInstanceOf(ImportRowPayloadError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not echo invalid phone, email, identity, date, or salary values in issues', () => {
    const secrets = ['phone-secret', 'email-secret', 'id-secret', 'date-secret', 'salary-secret'];
    const result = validateImportRow({
      rawData: {
        name: 'Teacher',
        phone: secrets[0],
        email: secrets[1],
        id: secrets[2],
        dob: secrets[3],
        salary: secrets[4],
      },
      mappedData: null,
      errors: null,
      warnings: null,
    }, [
      { uploadedColumn: 'name', mappedField: 'full_name' },
      { uploadedColumn: 'phone', mappedField: 'phone_1' },
      { uploadedColumn: 'email', mappedField: 'email' },
      { uploadedColumn: 'id', mappedField: 'id_number' },
      { uploadedColumn: 'dob', mappedField: 'date_of_birth' },
      { uploadedColumn: 'salary', mappedField: 'monthly_salary' },
    ], 'teachers');
    const messages = JSON.stringify([result.errors, result.warnings]);
    for (const secret of secrets) expect(messages).not.toContain(secret);
  });

  it('keeps import routes on encrypted storage, defensive permissions, and protected identity writes', () => {
    const upload = readFileSync(join(process.cwd(), 'src/app/api/import/upload/route.ts'), 'utf8');
    const preview = readFileSync(join(process.cwd(), 'src/app/api/import/[session_id]/route.ts'), 'utf8');
    const validation = readFileSync(join(process.cwd(), 'src/app/api/import/[session_id]/validate/route.ts'), 'utf8');
    const confirm = readFileSync(join(process.cwd(), 'src/app/api/import/[session_id]/confirm/route.ts'), 'utf8');
    for (const source of [upload, preview, validation, confirm]) {
      expect(source).toContain("session.can('students.manage')");
    }
    expect(upload).toContain('protectedImportRowPayload');
    expect(upload).not.toMatch(/raw_data\s*:\s*row/);
    expect(preview).toContain('importRowPayloadForResponse');
    expect(confirm).toContain('protectIdNumber');
    expect(confirm).not.toContain('console.error');
    expect(validation).not.toContain('غير صحيح: ${');
  });
});
