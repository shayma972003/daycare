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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const existing = await prisma.attendance.findFirst({
    where: {
      studentId: id,
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

  // Get hourlyLateFee from Settings
  const settings = await prisma.settings.findFirst({ where: { schoolId } });
  const hourlyLateFee = settings?.hourlyLateFee ?? 0;
  const lateFee = (lateMinutes / 60) * hourlyLateFee;

  // Update attendance
  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: {
      checkoutAt: now,
      lateMinutes,
      lateFee,
    },
  });

  // Update student lateHours
  if (lateMinutes > 0) {
    await prisma.student.update({
      where: { id },
      data: {
        lateHours: { increment: lateMinutes / 60 },
      },
    });
  }

  await logAction({
    school_id: schoolId,
    action: `تسجيل خروج الطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(attendance);
}
