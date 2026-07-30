import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
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
  const [inH, inM] = (school?.teacherCheckinTime ?? "08:00").split(":").map(Number);
  const [outH, outM] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
  const requiredHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;

  const actualHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
  const compensated = requiredHours <= 0 || actualHours >= requiredHours;

  let lateHours = 0;
  let lateMinutes = 0;
  if (!compensated) {
    lateHours = requiredHours - actualHours;
    lateMinutes = Math.round(lateHours * 60);
  }

  const attendance = await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: {
      checkoutAt: nowUtc,
      lateMinutes,
      requiredHours,
      compensated,
    },
  });

  await prisma.teacher.update({
    where: { id },
    data: {
      attendanceHours: { increment: actualHours },
      lateHours: { increment: lateHours },
    },
  });

  await logAction({
    school_id: schoolId,
    action: `تسجيل خروج المعلم: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(attendance);
}
