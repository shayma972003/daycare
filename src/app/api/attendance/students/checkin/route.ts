import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  student_id: z.string(),
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
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { student_id } = parsed.data;

  // Confirm student belongs to school
  const student = await prisma.student.findFirst({
    where: { id: student_id, schoolId },
  });
  if (!student) {
    return Response.json({ error: "الطالب غير موجود" }, { status: 404 });
  }

  // Compute today in AST (UTC+3)
  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  // Check for existing active attendance (no checkout)
  const existing = await prisma.attendance.findFirst({
    where: {
      studentId: student_id,
      schoolId,
      date: { gte: todayAst, lt: tomorrowAst },
    },
  });

  if (existing && !existing.checkoutAt) {
    return Response.json({ error: "الطالب مسجل دخوله بالفعل" }, { status: 409 });
  }

  // Create new attendance record (even if re-entry after checkout)
  const att = await prisma.attendance.create({
    data: {
      studentId: student_id,
      schoolId,
      classId: student.classId ?? null,
      checkinAt: new Date(),
      date: todayAst,
    },
  });

  return Response.json({ attendance_id: att.id, checkin_time: att.checkinAt }, { status: 201 });
}
