import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { studentClassWhere } from "@/lib/student-access-scope";
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

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null, ...studentClassWhere(session) },
  });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const period = invoiceMonthRange(new Date());
  // This is a financial waiver for the current invoice month. Keep the
  // attendance minutes and the student's lifetime late-hours total intact so
  // attendance history remains accurate and auditable.
  const waived = await prisma.attendance.updateMany({
    where: {
      studentId: id,
      schoolId,
      date: { gte: period.from, lte: period.to },
      lateFee: { gt: 0 },
    },
    data: { lateFee: 0 },
  });

  await logAction({
    school_id: schoolId,
    action: `إعفاء رسوم تأخير الشهر الحالي للطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
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
