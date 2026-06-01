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
    where: { teacherId: teacher_id, schoolId, date: { gte: todayAst, lt: tomorrowAst } },
  });

  if (existing && !existing.checkoutAt)
    return Response.json({ error: "المعلم مسجل دخوله بالفعل" }, { status: 409 });

  const att = await prisma.teacherAttendance.create({
    data: { teacherId: teacher_id, schoolId, checkinAt: nowUtc, date: todayAst },
  });

  return Response.json({ attendance_id: att.id, checkin_time: att.checkinAt }, { status: 201 });
}
