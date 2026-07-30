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

  const now = new Date();

  let attendance;
  if (existing) {
    attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: { checkinAt: now },
    });
  } else {
    attendance = await prisma.attendance.create({
      data: {
        studentId: id,
        schoolId,
        classId: student.classId ?? null,
        checkinAt: now,
        date: today,
      },
    });
  }

  await logAction({
    school_id: schoolId,
    action: `تسجيل وصول الطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(attendance);
}
