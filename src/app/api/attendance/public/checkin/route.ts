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

    const attendance = existing
      ? await prisma.attendance.update({ where: { id: existing.id }, data: { checkinAt: now } })
      : await prisma.attendance.create({
          data: { studentId: person_id, schoolId: school_id, classId: student.classId ?? null, checkinAt: now, date: today },
        });

    return Response.json(attendance);
  }

  const teacher = await prisma.teacher.findFirst({ where: { id: person_id, schoolId: school_id, deletedAt: null } });
  if (!teacher) return Response.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.teacherAttendance.findFirst({
    where: { teacherId: person_id, schoolId: school_id, date: { gte: today, lt: tomorrow } },
  });

  const attendance = existing && !existing.checkoutAt
    ? existing
    : await prisma.teacherAttendance.create({
        data: { teacherId: person_id, schoolId: school_id, checkinAt: now, date: today },
      });

  return Response.json(attendance);
}
