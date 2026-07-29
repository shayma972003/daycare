import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function DELETE(
  request: Request,
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

  await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { studentId: id } }),
    prisma.invoice.updateMany({ where: { studentId: id }, data: { studentId: null } }),
    prisma.student.delete({ where: { id } }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `تم حذف الطالب "${student.name}" نهائياً`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true }, { status: 200 });
}
