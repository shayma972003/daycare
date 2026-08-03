import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  await logAction({
    school_id: schoolId,
    action: `تم حذف المعلم "${teacher.name}" نهائياً`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true }, { status: 200 });
}
