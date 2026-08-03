import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Returns the once-per-session popups **and marks them as shown**.
 *
 * That write is why this is a POST. As a GET it was fetchable by any prefetch,
 * link preview, crawler or browser cache warm-up — each of which would stamp
 * `payment_notified_at` and permanently suppress a popup no human ever saw. A
 * GET that mutates is also outside what CSRF protection assumes about safe
 * methods.
 */
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
  const schoolId = session.user.schoolId;
  void request;

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

  // `schoolId` repeated on the writes — defence in depth, same rule as the rest
  // of the tenant-scoped routes.
  if (expiredStudents.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: expiredStudents.map((s) => s.id) }, schoolId },
      data: { payment_notified_at: new Date() },
    });
  }
  if (suspendedStudents.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: suspendedStudents.map((s) => s.id) }, schoolId },
      data: { suspension_notified_at: new Date() },
    });
  }

  return Response.json({
    expiredStudents: expiredStudents.map((s) => ({ id: s.id, full_name: s.name, enrollment_end_date: s.enrollmentEndDate })),
    suspendedStudents: suspendedStudents.map((s) => ({ id: s.id, full_name: s.name })),
  });
}
