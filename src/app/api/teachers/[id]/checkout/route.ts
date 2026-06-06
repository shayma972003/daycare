import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
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

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // AST today boundaries (UTC+3)
  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const existing = await prisma.teacherAttendance.findFirst({
    where: {
      teacherId: id,
      schoolId,
      date: { gte: todayAst, lt: tomorrowAst },
      checkinAt: { not: null },
      checkoutAt: null,
    },
  });

  if (!existing) {
    return Response.json({ error: "لا يوجد تسجيل دخول نشط اليوم" }, { status: 404 });
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  const [h, m] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);

  // Build cutoff in UTC (subtract 3h offset)
  const cutoffUtc = new Date(nowUtc);
  cutoffUtc.setUTCHours(h - 3, m, 0, 0);

  const lateMinutes = nowUtc > cutoffUtc
    ? Math.floor((nowUtc.getTime() - cutoffUtc.getTime()) / 60000)
    : 0;
  const totalHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
  const lateHours = lateMinutes / 60;

  const attendance = await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: { checkoutAt: nowUtc, lateMinutes },
  });

  await prisma.teacher.update({
    where: { id },
    data: {
      attendanceHours: { increment: totalHours },
      lateHours: { increment: lateHours },
    },
  });

  return Response.json(attendance);
}
