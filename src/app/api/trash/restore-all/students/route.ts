import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const students = await prisma.student.findMany({
    where: { schoolId, deletedAt: { not: null } },
  });

  let restored = 0;
  let needsReassignment = 0;

  for (const student of students) {
    const updateData: Record<string, unknown> = { deletedAt: null };

    if (student.classId) {
      const cls = await prisma.class.findUnique({ where: { id: student.classId } });
      if (!cls || cls.deletedAt !== null) {
        updateData.classId = null;
        updateData.needsClassWarning = true;
        needsReassignment++;
      }
    }

    await prisma.student.update({ where: { id: student.id }, data: updateData });
    restored++;
  }

  await logAction({
    school_id: schoolId,
    action: "استعادة جميع الطلاب من سلة المحذوفات",
    entity_type: "student",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ restored, needsReassignment }, { status: 200 });
}
