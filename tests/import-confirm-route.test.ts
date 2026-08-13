import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { protectedImportRowPayload, revealImportRowPayload } from '@/lib/import-row-payload';

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionErrorResponse: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  rowFindFirst: vi.fn(),
  rowUpdate: vi.fn(),
  rowUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  guardianFindFirst: vi.fn(),
  guardianCreate: vi.fn(),
  studentCreate: vi.fn(),
  teacherCreate: vi.fn(),
  transaction: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    importSession: { updateMany: mocks.sessionUpdateMany, findFirst: mocks.sessionFindFirst },
    importRow: { updateMany: mocks.rowUpdateMany },
  },
}));
vi.mock('@/lib/activity-logger', () => ({ logAction: mocks.logAction }));

import { POST as confirmImport } from '@/app/api/import/[session_id]/confirm/route';

function row(mappedData: Record<string, unknown>) {
  return {
    id: 'row-1',
    session_id: 'import-1',
    row_number: 2,
    status: 'valid',
    created_at: new Date(),
    ...protectedImportRowPayload({ rawData: mappedData, mappedData, errors: [], warnings: [] }),
  };
}

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString('base64');
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireSession.mockResolvedValue({
    user: { schoolId: 'school-1', name: 'Manager' },
    can: (permission: string) => permission === 'students.manage',
  });
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.queryRaw.mockResolvedValue([{ id: 'row-1' }]);
  mocks.rowUpdate.mockResolvedValue({});
  mocks.rowUpdateMany.mockResolvedValue({ count: 0 });
  mocks.guardianFindFirst.mockResolvedValue(null);
  mocks.guardianCreate.mockResolvedValue({ id: 'guardian-1' });
  mocks.studentCreate.mockResolvedValue({ id: 'student-1' });
  mocks.teacherCreate.mockResolvedValue({ id: 'teacher-1' });
  mocks.logAction.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.queryRaw,
    importRow: { findFirst: mocks.rowFindFirst, update: mocks.rowUpdate },
    guardian: { findFirst: mocks.guardianFindFirst, create: mocks.guardianCreate },
    student: { create: mocks.studentCreate },
    teacher: { create: mocks.teacherCreate },
  }));
});

async function confirm() {
  return confirmImport(new Request('http://localhost/api/import/import-1/confirm', { method: 'POST' }), {
    params: Promise.resolve({ session_id: 'import-1' }),
  });
}

describe('import confirmation route', () => {
  it.each([
    ['students', { full_name: 'Child', id_number: '1098765432', guardian_name: 'Guardian' }],
    ['teachers', { full_name: 'Teacher', id_number: '1087654321', monthly_salary: 9000 }],
  ] as const)('decrypts a %s row, protects identity, and clears staged data atomically', async (type, mappedData) => {
    const encryptedRow = row(mappedData);
    mocks.sessionFindFirst.mockResolvedValue({
      id: 'import-1', school_id: 'school-1', type, rows: [{ id: 'row-1', status: 'valid' }],
    });
    mocks.rowFindFirst.mockResolvedValue(encryptedRow);

    const response = await confirm();

    expect(response.status).toBe(200);
    const create = type === 'students' ? mocks.studentCreate : mocks.teacherCreate;
    const data = create.mock.calls[0][0].data;
    expect(data.name).toBe(mappedData.full_name);
    expect(data.idNumber).toBeNull();
    expect(data.encryptedIdNumber).toMatch(/^v1\./);
    expect(data.idNumberHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain(mappedData.id_number);
    expect(mocks.rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({
        status: 'imported',
        encrypted_payload: null,
      }),
    });
  });

  it('keeps failed staged data encrypted and stores only a generic error', async () => {
    const encryptedRow = row({ full_name: 'Teacher', email: 'secret@example.test' });
    mocks.sessionFindFirst.mockResolvedValue({
      id: 'import-1', school_id: 'school-1', type: 'teachers', rows: [{ id: 'row-1', status: 'valid' }],
    });
    mocks.rowFindFirst.mockResolvedValue(encryptedRow);
    mocks.teacherCreate.mockRejectedValueOnce(new Error('provider leaked secret@example.test'));

    const response = await confirm();

    expect(response.status).toBe(200);
    const failureWrite = mocks.rowUpdate.mock.calls.at(-1)?.[0];
    expect(failureWrite.data.status).toBe('skipped');
    expect(JSON.stringify(failureWrite)).not.toContain('secret@example.test');
    const payload = revealImportRowPayload({
      encrypted_payload: failureWrite.data.encrypted_payload,
      raw_data: null,
      mapped_data: null,
      errors: null,
      warnings: null,
    });
    expect(payload.mappedData).toMatchObject({ email: 'secret@example.test' });
    expect(payload.errors).toEqual([{ message: 'تعذر استيراد هذا الصف', type: 'error' }]);
  });

  it('rejects a second confirmation before touching any row', async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.sessionFindFirst.mockResolvedValue({ status: 'confirming', expires_at: new Date(Date.now() + 60_000) });
    expect((await confirm()).status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an expired session before touching any row', async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.sessionFindFirst.mockResolvedValue({ status: 'validated', expires_at: new Date(0) });
    expect((await confirm()).status).toBe(410);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
