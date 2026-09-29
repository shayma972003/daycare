import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { invoiceMonthRange } from "@/lib/invoice-lateness";

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

  const period = invoiceMonthRange(new Date());
  // Mark the current month's delay as financially compensated/waived without
  // deleting the recorded minutes or changing the lifetime late-hours total.
  const waived = await prisma.teacherAttendance.updateMany({
    where: {
      teacherId: id,
      schoolId,
      date: { gte: period.from, lte: period.to },
      compensated: false,
      lateMinutes: { gt: 0 },
    },
    data: { compensated: true },
  });

  await logAction({
    school_id: schoolId,
    action: `إعفاء خصم تأخير الشهر الحالي للمعلم: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({
    success: true,
    waivedAttendanceCount: waived.count,
    periodFrom: period.from,
    periodTo: period.to,
  });
}
