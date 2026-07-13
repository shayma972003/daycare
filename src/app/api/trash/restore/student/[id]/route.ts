import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = { deletedAt: null };
  let needsReassignment = false;

  if (student.classId) {
    const cls = await prisma.class.findUnique({ where: { id: student.classId } });
    if (!cls || cls.deletedAt !== null) {
      updateData.classId = null;
      updateData.needsClassWarning = true;
      needsReassignment = true;
    }
  }

  await prisma.student.update({ where: { id }, data: updateData });

  return Response.json({ success: true, needsReassignment }, { status: 200 });
}
