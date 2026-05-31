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

  const student = await prisma.student.findFirst({ where: { id, schoolId } });
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

  return Response.json(attendance);
}
