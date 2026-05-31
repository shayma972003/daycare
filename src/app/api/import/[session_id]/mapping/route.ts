import { requireSession } from '@/lib/session';
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
  try { session = await requireSession(); } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
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

  await prisma.importSession.update({
    where: { id: session_id },
    data: { column_mapping: parsed.data.mapping as object[] },
  });

  return Response.json({ success: true });
}
