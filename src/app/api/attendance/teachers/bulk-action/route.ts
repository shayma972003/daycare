import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  teacherIds: z.array(z.string()).min(1),
  action: z.enum(["checkin", "checkout"]),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { teacherIds, action } = parsed.data;

  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  let processed = 0;
  let skipped = 0;

  if (action === "checkin") {
    for (const teacherId of teacherIds) {
      const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId, deletedAt: null } });
      if (!teacher) {
        skipped++;
        continue;
      }

      const existing = await prisma.teacherAttendance.findFirst({
        where: { teacherId, schoolId, date: { gte: todayAst, lt: tomorrowAst } },
      });

      if (existing && !existing.checkoutAt) {
        skipped++;
        continue;
      }

      await prisma.teacherAttendance.create({
        data: { teacherId, schoolId, checkinAt: nowUtc, date: todayAst },
      });
      processed++;
    }
  } else {
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    const [h, m] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
    const cutoffUtc = new Date();
    cutoffUtc.setUTCHours(h - 3, m, 0, 0);

    for (const teacherId of teacherIds) {
      const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId, deletedAt: null } });
      if (!teacher) {
        skipped++;
        continue;
      }

      const existing = await prisma.teacherAttendance.findFirst({
        where: { teacherId, schoolId, date: { gte: todayAst, lt: tomorrowAst }, checkoutAt: null, checkinAt: { not: null } },
      });

      if (!existing) {
        skipped++;
        continue;
      }

      const lateMinutes = nowUtc > cutoffUtc ? Math.floor((nowUtc.getTime() - cutoffUtc.getTime()) / 60000) : 0;
      const totalHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
      const lateHours = lateMinutes / 60;

      await prisma.teacherAttendance.update({
        where: { id: existing.id },
        data: { checkoutAt: nowUtc, lateMinutes },
      });

      await prisma.teacher.update({
        where: { id: teacherId },
        data: { attendanceHours: { increment: totalHours }, lateHours: { increment: lateHours } },
      });

      processed++;
    }
  }

  return Response.json({ processed, skipped }, { status: 200 });
}
