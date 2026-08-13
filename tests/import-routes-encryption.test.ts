import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealImportRowPayload } from '@/lib/import-row-payload';

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionErrorResponse: vi.fn(),
  transaction: vi.fn(),
  sessionCreate: vi.fn(),
  rowCreateMany: vi.fn(),
  findFirst: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    importSession: { findFirst: mocks.findFirst },
  },
}));
vi.mock('@/lib/activity-logger', () => ({ logAction: mocks.logAction }));
vi.mock('@/lib/file-upload', () => ({ MAX_SPREADSHEET_BYTES: 5 * 1024 * 1024 }));

import { POST as uploadImport } from '@/app/api/import/upload/route';
import { GET as getImport } from '@/app/api/import/[session_id]/route';

const originalKey = process.env.PII_ENCRYPTION_KEY;
const originalPepper = process.env.PII_INDEX_PEPPER;

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString('base64');
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireSession.mockResolvedValue({
    user: { schoolId: 'school-1', name: 'Manager' },
    can: (permission: string) => permission === 'students.manage',
  });
  mocks.sessionCreate.mockResolvedValue({ id: 'import-1' });
  mocks.rowCreateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
    importSession: { create: mocks.sessionCreate },
    importRow: { createMany: mocks.rowCreateMany },
  }));
  mocks.logAction.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalKey;
  if (originalPepper === undefined) delete process.env.PII_INDEX_PEPPER;
  else process.env.PII_INDEX_PEPPER = originalPepper;
});

async function upload(type: 'students' | 'teachers') {
  const form = new FormData();
  const csv = type === 'students'
    ? 'name,id,phone,email\nChild,1098765432,0500000000,child@example.test'
    : 'name,id,phone,email,salary\nTeacher,1087654321,0511111111,teacher@example.test,9000';
  form.append('file', new Blob([csv], { type: 'text/csv' }), `${type}.csv`);
  form.append('type', type);
  return uploadImport(new Request('http://localhost/api/import/upload', { method: 'POST', body: form }));
}

describe('encrypted import routes', () => {
  it.each(['students', 'teachers'] as const)('stores %s upload rows only as ciphertext', async (type) => {
    const response = await upload(type);
    expect(response.status).toBe(201);
    const rows = mocks.rowCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(type === 'students' ? '1098765432' : '1087654321');
    expect(rows[0].encrypted_payload).toMatch(/^v1\./);
    expect(revealImportRowPayload({
      ...rows[0],
      raw_data: null,
      mapped_data: null,
      errors: null,
      warnings: null,
    }).rawData).toMatchObject({ name: type === 'students' ? 'Child' : 'Teacher' });
  });

  it('returns decrypted preview data only for an authorized session in the same school', async () => {
    const encryptedResponse = await upload('students');
    expect(encryptedResponse.status).toBe(201);
    const stored = mocks.rowCreateMany.mock.calls[0][0].data[0];
    mocks.findFirst.mockResolvedValue({
      id: 'import-1',
      school_id: 'school-1',
      expires_at: new Date(Date.now() + 60_000),
      rows: [{
        id: 'row-1',
        session_id: 'import-1',
        row_number: 2,
        status: 'pending',
        created_at: new Date(),
        ...stored,
      }],
    });
    const response = await getImport(new Request('http://localhost/api/import/import-1'), {
      params: Promise.resolve({ session_id: 'import-1' }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'import-1', school_id: 'school-1' },
    }));
    expect(body.rows[0].raw_data).toMatchObject({ id: '1098765432' });
    expect(body.rows[0]).not.toHaveProperty('encrypted_payload');
    expect(JSON.stringify(body)).not.toContain(stored.encrypted_payload);
  });

  it('denies preview before querying when the defensive permission is absent', async () => {
    mocks.requireSession.mockResolvedValue({
      user: { schoolId: 'school-1' },
      can: () => false,
    });
    const response = await getImport(new Request('http://localhost/api/import/import-1'), {
      params: Promise.resolve({ session_id: 'import-1' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
