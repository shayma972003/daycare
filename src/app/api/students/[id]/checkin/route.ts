import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly } from "@/lib/datetime";

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

  const now = new Date();
  // AST business day. Host-local midnight flipped the day three hours early on
  // a UTC server, so this route and the kiosk disagreed about which day it was.
  const today = astDateOnly(now);

  // Upsert against the (studentId, date) unique key: a double click updates the
  // same row rather than racing findFirst-then-create into a duplicate.
  const attendance = await prisma.attendance.upsert({
    where: { studentId_date: { studentId: id, date: today } },
    create: {
      studentId: id,
      schoolId,
      classId: student.classId ?? null,
      checkinAt: now,
      date: today,
    },
    update: { checkinAt: now },
  });

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
