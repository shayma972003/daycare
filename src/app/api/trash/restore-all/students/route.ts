import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  return Response.json({ restored, needsReassignment }, { status: 200 });
}
