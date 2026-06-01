import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ teacher_id: z.string() });

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { teacher_id } = parsed.data;

  const teacher = await prisma.teacher.findFirst({ where: { id: teacher_id, schoolId } });
  if (!teacher) return Response.json({ error: "المعلم غير موجود" }, { status: 404 });

  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const existing = await prisma.teacherAttendance.findFirst({
    where: { teacherId: teacher_id, schoolId, date: { gte: todayAst, lt: tomorrowAst }, checkoutAt: null, checkinAt: { not: null } },
  });

  if (!existing) return Response.json({ error: "لا يوجد تسجيل دخول نشط" }, { status: 404 });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  const [h, m] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);

  const cutoffUtc = new Date();
  cutoffUtc.setUTCHours(h - 3, m, 0, 0);

  const lateMinutes = nowUtc > cutoffUtc ? Math.floor((nowUtc.getTime() - cutoffUtc.getTime()) / 60000) : 0;
  const totalHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
  const lateHours = lateMinutes / 60;

  await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: { checkoutAt: nowUtc, lateMinutes },
  });

  await prisma.teacher.update({
    where: { id: teacher_id },
    data: { attendanceHours: { increment: totalHours }, lateHours: { increment: lateHours } },
  });

  return Response.json({ checkout_time: nowUtc, total_hours: totalHours, late_hours: lateHours }, { status: 200 });
}
