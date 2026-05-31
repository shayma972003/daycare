import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(
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

  // Reset lateHours on student
  await prisma.student.update({
    where: { id },
    data: { lateHours: 0 },
  });

  // Reset lateFee on all today's attendance records
  await prisma.attendance.updateMany({
    where: {
      studentId: id,
      schoolId,
      date: { gte: today, lt: tomorrow },
    },
    data: { lateFee: 0 },
  });

  return Response.json({ success: true });
}
