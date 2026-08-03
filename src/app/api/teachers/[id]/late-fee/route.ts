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

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Clearing `lateHours` without touching the attendance rows left the two
  // permanently inconsistent — the teacher showed zero while the records that
  // produced the figure still carried it.
  await prisma.$transaction([
    prisma.teacher.update({
      where: { id },
      data: { lateHours: 0 },
    }),
    prisma.teacherAttendance.updateMany({
      where: { teacherId: id, schoolId },
      data: { lateMinutes: 0, compensated: true },
    }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `حذف رسوم التأخير للمعلم: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
