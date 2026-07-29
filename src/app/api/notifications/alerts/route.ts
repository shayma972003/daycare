import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  const [expiredStudents, suspendedStudents] = await Promise.all([
    prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isActive: true,
        enrollmentEndDate: { lt: new Date() },
        payment_notified_at: null,
      },
      select: { id: true, name: true, enrollmentEndDate: true },
    }),
    prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        paymentStatus: "SUSPENDED",
        suspension_notified_at: null,
      },
      select: { id: true, name: true },
    }),
  ]);

  if (expiredStudents.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: expiredStudents.map((s) => s.id) } },
      data: { payment_notified_at: new Date() },
    });
  }
  if (suspendedStudents.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: suspendedStudents.map((s) => s.id) } },
      data: { suspension_notified_at: new Date() },
    });
  }

  return Response.json({
    expiredStudents: expiredStudents.map((s) => ({ id: s.id, full_name: s.name, enrollment_end_date: s.enrollmentEndDate })),
    suspendedStudents: suspendedStudents.map((s) => ({ id: s.id, full_name: s.name })),
  });
}
