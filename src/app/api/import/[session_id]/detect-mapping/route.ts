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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { session_id } = await params;

  const importSession = await prisma.importSession.findFirst({
    where: { id: session_id, school_id: schoolId },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });

  const headers = (importSession.original_headers as string[]) ?? [];
  const type = importSession.type as 'students' | 'teachers';
  const mapping = detectMapping(headers, type);

  await prisma.importSession.update({
    where: { id: session_id },
    data: { column_mapping: mapping as object[] },
  });

  return Response.json({ mapping }, { status: 200 });
}
