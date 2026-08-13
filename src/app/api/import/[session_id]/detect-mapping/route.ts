import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { detectMapping } from '@/lib/import-mapper';

export async function POST(_req: Request, { params }: { params: Promise<{ session_id: string }> }) {
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

  const headers = (importSession.original_headers as string[]) ?? [];
  const type = importSession.type as 'students' | 'teachers';
  const mapping = detectMapping(headers, type);

  const updated = await prisma.importSession.updateMany({
    where: {
      id: session_id,
      school_id: schoolId,
      status: { in: ['pending', 'validated', 'completed'] },
      expires_at: { gt: new Date() },
    },
    data: {
      column_mapping: mapping as object[],
      status: 'pending',
      valid_rows: 0,
      error_rows: 0,
    },
  });
  if (updated.count !== 1) {
    return Response.json({ error: 'Import session is not editable' }, { status: 409 });
  }

  return Response.json({ mapping }, { status: 200 });
}
