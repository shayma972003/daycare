import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  student_id: z.string(),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
    where: { id: student_id, schoolId, deletedAt: null },
    select: { id: true, classId: true, attendanceType: true },
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

  // Find active attendance (checked in, not yet checked out)
  const existing = await prisma.attendance.findFirst({
    where: {
      studentId: student_id,
      schoolId,
      date: { gte: todayAst, lt: tomorrowAst },
      checkoutAt: null,
      checkinAt: { not: null },
    },
  });

  if (!existing) {
    return Response.json({ error: "لا يوجد تسجيل دخول نشط" }, { status: 404 });
  }

  // Compute late fee
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { settings: true },
  });

  const now = new Date();
  const totalHours = (now.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;

  // Only calculate late hours for regular attendance
  const isRegular = (student?.attendanceType ?? "REGULAR") === "REGULAR";
  let lateMinutes = 0;
  let lateHours = 0;
  let lateFee = 0;

  if (isRegular) {
    const [h, m] = (school?.studentCheckoutTime ?? "17:00").split(":").map(Number);
    const cutoffUtc = new Date();
    cutoffUtc.setUTCHours(h - 3, m, 0, 0);
    lateMinutes = now > cutoffUtc ? Math.floor((now.getTime() - cutoffUtc.getTime()) / 60000) : 0;
    lateHours = lateMinutes / 60;
    lateFee = lateHours * (school?.settings?.hourlyLateFee ?? 0);
  }

  // Update attendance
  await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkoutAt: now, lateMinutes, lateFee },
  });

  // Update student hours
  await prisma.student.update({
    where: { id: student_id },
    data: {
      attendanceHours: { increment: totalHours },
      lateHours: { increment: lateHours },
    },
  });

  return Response.json(
    { checkout_time: now, total_hours: totalHours, late_hours: lateHours, late_fee: lateFee },
    { status: 200 }
  );
}
