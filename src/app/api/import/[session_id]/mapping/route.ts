import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const mappingEntrySchema = z.object({
  uploadedColumn: z.string(),
  mappedField: z.string().nullable(),
  confidence: z.number(),
  needs_review: z.boolean(),
});

const schema = z.object({ mapping: z.array(mappingEntrySchema) });

export async function PUT(request: Request, { params }: { params: Promise<{ session_id: string }> }) {
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

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const importSession = await prisma.importSession.findFirst({
    where: { id: session_id, school_id: schoolId },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });

  const updated = await prisma.importSession.updateMany({
    where: {
      id: session_id,
      school_id: schoolId,
      status: { in: ['pending', 'validated', 'completed'] },
      expires_at: { gt: new Date() },
    },
    data: {
      column_mapping: parsed.data.mapping as object[],
      status: 'pending',
      valid_rows: 0,
      error_rows: 0,
    },
  });
  if (updated.count !== 1) {
    return Response.json({ error: 'Import session is not editable' }, { status: 409 });
  }

  return Response.json({ success: true });
}
