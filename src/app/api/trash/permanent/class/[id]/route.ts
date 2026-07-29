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

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.activityInvite.deleteMany({ where: { classId: id } }),
    prisma.attendance.updateMany({ where: { classId: id }, data: { classId: null } }),
    prisma.student.updateMany({ where: { classId: id }, data: { classId: null } }),
    prisma.class.delete({ where: { id } }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `تم حذف الفصل "${cls.name}" نهائياً`,
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true }, { status: 200 });
}
