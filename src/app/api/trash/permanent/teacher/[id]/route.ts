import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(
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

  const teacher = await prisma.teacher.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.teacherAttendance.deleteMany({ where: { teacherId: id } }),
    prisma.class.updateMany({ where: { teacherId: id }, data: { teacherId: null } }),
    prisma.activity.updateMany({ where: { teacherId: id }, data: { teacherId: null } }),
    prisma.invoice.updateMany({ where: { teacherId: id }, data: { teacherId: null } }),
    prisma.teacher.delete({ where: { id } }),
  ]);

  return Response.json({ success: true }, { status: 200 });
}
