import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ teacher_id: z.string() });

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { teacher_id } = parsed.data;

  const teacher = await prisma.teacher.findFirst({ where: { id: teacher_id, schoolId, deletedAt: null } });
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
  const [inH, inM] = (school?.teacherCheckinTime ?? "08:00").split(":").map(Number);
  const [outH, outM] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
  const requiredHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;

  const totalHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
  const compensated = requiredHours <= 0 || totalHours >= requiredHours;
  let lateHours = 0;
  let lateMinutes = 0;
  if (!compensated) {
    lateHours = requiredHours - totalHours;
    lateMinutes = Math.round(lateHours * 60);
  }

  await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: { checkoutAt: nowUtc, lateMinutes, requiredHours, compensated },
  });

  await prisma.teacher.update({
    where: { id: teacher_id },
    data: { attendanceHours: { increment: totalHours }, lateHours: { increment: lateHours } },
  });

  return Response.json({ checkout_time: nowUtc, total_hours: totalHours, late_hours: lateHours }, { status: 200 });
}
