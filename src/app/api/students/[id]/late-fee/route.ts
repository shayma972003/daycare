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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // `Student.lateHours` is a lifetime total, but only *today's* attendance rows
  // were being cleared, so the two drifted permanently apart: the student showed
  // zero late hours while historical rows still carried fees. Both are cleared
  // together, in one transaction.
  await prisma.$transaction([
    prisma.student.update({
      where: { id },
      data: { lateHours: 0 },
    }),
    prisma.attendance.updateMany({
      where: { studentId: id, schoolId },
      data: { lateFee: 0, lateMinutes: 0 },
    }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `حذف رسوم التأخير للطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
