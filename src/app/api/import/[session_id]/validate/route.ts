import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import {
  protectedImportRowPayload,
  revealImportRowPayload,
  updateImportRowPayload,
} from '@/lib/import-row-payload';
import { validateImportRow, type ImportMappingEntry } from '@/lib/import-row-validation';

export async function POST(_req: Request, { params }: { params: Promise<{ session_id: string }> }) {
  let session;
  try { session = await requireSession(); } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.can('students.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const schoolId = session.user.schoolId;
  const { session_id: sessionId } = await params;

  const claimed = await prisma.importSession.updateMany({
    where: {
      id: sessionId,
      school_id: schoolId,
      status: { in: ['pending', 'validated', 'completed'] },
      expires_at: { gt: new Date() },
    },
    data: { status: 'validating' },
  });
  if (claimed.count !== 1) {
    const existing = await prisma.importSession.findFirst({
      where: { id: sessionId, school_id: schoolId },
      select: { expires_at: true },
    });
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
    if (existing.expires_at <= new Date()) {
      return Response.json({ error: 'Import session expired' }, { status: 410 });
    }
    return Response.json({ error: 'Import session is busy' }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ImportSession" WHERE "id" = ${sessionId} AND "school_id" = ${schoolId} FOR UPDATE`;
      const importSession = await tx.importSession.findFirst({
        where: { id: sessionId, school_id: schoolId },
        include: { rows: { orderBy: { row_number: 'asc' } } },
      });
      if (!importSession) return { kind: 'missing' as const };
      if (importSession.expires_at <= new Date()) return { kind: 'expired' as const };
      if (importSession.status !== 'validating') {
        return { kind: 'conflict' as const };
      }

      const mapping = (importSession.column_mapping as ImportMappingEntry[] | null) ?? [];
      const seenKeys = new Map<string, number>();
      let validRows = 0;
      let errorRows = 0;

      for (const row of importSession.rows) {
        if (row.status === 'imported') continue;
        const payload = revealImportRowPayload(row);
        const preliminary = validateImportRow(payload, mapping, importSession.type as 'students' | 'teachers');
        const isStudent = importSession.type === 'students';
        const phoneField = isStudent ? 'guardian_phone_1' : 'phone_1';
        const name = String(preliminary.mappedData.full_name ?? '').trim().toLowerCase();
        const phone = String(preliminary.mappedData[phoneField] ?? '').trim();
        const duplicateKey = name ? `${name}|${phone}` : '';
        const duplicateAt = duplicateKey ? seenKeys.get(duplicateKey) : undefined;
        const validated = duplicateAt === undefined
          ? preliminary
          : validateImportRow(payload, mapping, importSession.type as 'students' | 'teachers', duplicateAt);
        if (duplicateKey && duplicateAt === undefined) seenKeys.set(duplicateKey, row.row_number);

        const status = validated.errors.length > 0 ? 'error' : 'valid';
        if (status === 'valid') validRows += 1;
        else errorRows += 1;
        await tx.importRow.update({
          where: { id: row.id },
          data: {
            status,
            ...protectedImportRowPayload(updateImportRowPayload(payload, {
              mappedData: validated.mappedData,
              errors: validated.errors,
              warnings: validated.warnings,
            })),
          },
        });
      }

      await tx.importSession.update({
        where: { id: sessionId },
        data: { status: 'validated', valid_rows: validRows, error_rows: errorRows },
      });
      return { kind: 'ok' as const, validRows, errorRows };
    }, { timeout: 30_000 });

    if (result.kind === 'missing') return Response.json({ error: 'Not found' }, { status: 404 });
    if (result.kind === 'expired') return Response.json({ error: 'Import session expired' }, { status: 410 });
    if (result.kind === 'conflict') return Response.json({ error: 'Import session is not editable' }, { status: 409 });
    return Response.json({ valid_rows: result.validRows, error_rows: result.errorRows }, { status: 200 });
  } catch {
    await prisma.importSession.updateMany({
      where: { id: sessionId, school_id: schoolId, status: 'validating' },
      data: { status: 'pending' },
    }).catch(() => undefined);
    return Response.json({ error: 'Import validation failed' }, { status: 500 });
  }
}
