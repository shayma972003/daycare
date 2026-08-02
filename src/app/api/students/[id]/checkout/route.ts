import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly, astTimeOnDay } from "@/lib/datetime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, attendanceType: true },
  });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  // The business day in AST. This used host-local midnight, so on a UTC server
  // the day flipped three hours early and a late-evening checkout was written
  // against tomorrow.
  const today = astDateOnly(now);

  // `checkoutAt: null` makes this idempotent. Without it the request could be
  // replayed and each replay incremented the child's lifetime lateHours again.
  const existing = await prisma.attendance.findFirst({
    where: {
      studentId: id,
      schoolId,
      date: today,
      checkinAt: { not: null },
      checkoutAt: null,
    },
  });

  if (!existing) {
    return Response.json({ error: "لا يوجد تسجيل حضور نشط اليوم" }, { status: 404 });
  }

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({
      where: { schoolId },
      select: { hourlyLateFee: true },
    }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { studentCheckoutTime: true },
    }),
  ]);

  // Honours the school's configured closing time rather than a hardcoded 17:00
  // read in the server's timezone.
  const cutoff = astTimeOnDay(school?.studentCheckoutTime ?? "17:00", now);
  const isRegular = student.attendanceType === "REGULAR";
  const lateMinutes =
    isRegular && cutoff && now > cutoff
      ? Math.floor((now.getTime() - cutoff.getTime()) / 60_000)
      : 0;
  const lateFee = (lateMinutes / 60) * (settings?.hourlyLateFee ?? 0);

  // Attendance row and the running total move together, so a failure cannot
  // leave the two disagreeing.
  const [attendance] = await prisma.$transaction([
    prisma.attendance.update({
      where: { id: existing.id },
      data: { checkoutAt: now, lateMinutes, lateFee },
    }),
    ...(lateMinutes > 0
      ? [
          prisma.student.update({
            where: { id },
            data: { lateHours: { increment: lateMinutes / 60 } },
          }),
        ]
      : []),
  ]);

  await logAction({
    school_id: schoolId,
    action: `تسجيل انصراف الطفل: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(attendance);
}
