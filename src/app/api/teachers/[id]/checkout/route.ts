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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const existing = await prisma.teacherAttendance.findFirst({
    where: {
      teacherId: id,
      schoolId,
      date: { gte: today, lt: tomorrow },
    },
  });

  if (!existing) {
    return Response.json({ error: "No check-in found for today" }, { status: 404 });
  }

  const now = new Date();

  // Calculate late minutes: after 17:00
  const cutoff = new Date(now);
  cutoff.setHours(17, 0, 0, 0);

  let lateMinutes = 0;
  if (now > cutoff) {
    lateMinutes = Math.floor((now.getTime() - cutoff.getTime()) / 60000);
  }

  const attendance = await prisma.teacherAttendance.update({
    where: { id: existing.id },
    data: {
      checkoutAt: now,
      lateMinutes,
    },
  });

  // Update teacher lateHours
  if (lateMinutes > 0) {
    await prisma.teacher.update({
      where: { id },
      data: {
        lateHours: { increment: lateMinutes / 60 },
      },
    });
  }

  return Response.json(attendance);
}
