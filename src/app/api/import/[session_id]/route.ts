import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { logAction } from '@/lib/activity-logger';
import { importRowPayloadForResponse } from '@/lib/import-row-payload';

export async function GET(_req: Request, { params }: { params: Promise<{ session_id: string }> }) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }
  if (!session.can('students.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { session_id } = await params;

  const importSession = await prisma.importSession.findFirst({
    where: { id: session_id, school_id: schoolId },
    include: {
      rows: { orderBy: { row_number: 'asc' } },
    },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });
  if (importSession.expires_at <= new Date()) {
    return Response.json({ error: 'Import session expired' }, { status: 410 });
  }
  return Response.json({
    ...importSession,
    rows: importSession.rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      row_number: row.row_number,
      status: row.status,
      created_at: row.created_at,
      ...importRowPayloadForResponse(row),
    })),
  }, { status: 200 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ session_id: string }> }) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }
  if (!session.can('students.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { session_id } = await params;

  const importSession = await prisma.importSession.findFirst({
    where: { id: session_id, school_id: schoolId },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });

  await prisma.importSession.delete({ where: { id: session_id } });

  await logAction({
    school_id: schoolId,
    action: 'إلغاء جلسة استيراد',
    entity_type: 'import',
    entity_id: session_id,
    performed_by: session.user.name ?? 'المدير',
    request: req,
  });

  return Response.json({ success: true });
}
