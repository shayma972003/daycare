import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  person_id: z.string(),
  type: z.enum(["student", "teacher"]),
  school_id: z.string(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });
  const { person_id, type, school_id } = parsed.data;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  if (type === "student") {
    const student = await prisma.student.findFirst({ where: { id: person_id, schoolId: school_id, deletedAt: null } });
    if (!student) return Response.json({ error: "Not found" }, { status: 404 });

    const existing = await prisma.attendance.findFirst({
      where: { studentId: person_id, schoolId: school_id, date: { gte: today, lt: tomorrow } },
    });
    if (!existing) return Response.json({ error: "No check-in found for today" }, { status: 404 });

    const cutoff = new Date(now);
    cutoff.setHours(17, 0, 0, 0);
    let lateMinutes = 0;
    if (now > cutoff) {
      lateMinutes = Math.floor((now.getTime() - cutoff.getTime()) / 60000);
    }

    const settings = await prisma.settings.findFirst({ where: { schoolId: school_id } });
    const hourlyLateFee = settings?.hourlyLateFee ?? 0;
    const lateFee = (lateMinutes / 60) * hourlyLateFee;

    const attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: { checkoutAt: now, lateMinutes, lateFee },
    });

    if (lateMinutes > 0) {
      await prisma.student.update({
        where: { id: person_id },
        data: { lateHours: { increment: lateMinutes / 60 } },
      });
    }

    return Response.json(attendance);
  }

  const teacher = await prisma.teacher.findFirst({ where: { id: person_id, schoolId: school_id, deletedAt: null } });
  if (!teacher) return Response.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.teacherAttendance.findFirst({
    where: { teacherId: person_id, schoolId: school_id, date: { gte: today, lt: tomorrow }, checkoutAt: null, checkinAt: { not: null } },
  });
  if (!existing) return Response.json({ error: "لا يوجد تسجيل دخول نشط اليوم" }, { status: 404 });

  const school = await prisma.school.findUnique({ where: { id: school_id } });
  const [inH, inM] = (school?.teacherCheckinTime ?? "08:00").split(":").map(Number);
  const [outH, outM] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
  const requiredHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;

  const actualHours = (now.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
  const compensated = requiredHours <= 0 || actualHours >= requiredHours;

  let lateHours = 0;
  let lateMinutes = 0;
  if (!compensated) {
    lateHours = requiredHours - actualHours;
    lateMinutes = Math.round(lateHours * 60);
  }

  const attendance = await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: { checkoutAt: now, lateMinutes, requiredHours, compensated },
  });

  await prisma.teacher.update({
    where: { id: person_id },
    data: { attendanceHours: { increment: actualHours }, lateHours: { increment: lateHours } },
  });

  return Response.json(attendance);
}
