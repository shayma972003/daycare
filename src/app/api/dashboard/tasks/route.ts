import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import { grants } from "@/lib/permissions";
import { PaymentStatus } from "@/lib/payment-status";

/**
 * Everything the home screen needs, in one round trip.
 *
 * The screen shows six counts and a setup checklist. Fetched separately that is
 * eleven requests on every dashboard open, each paying its own `requireSession()`
 * — which is an indexed user lookup plus a school lookup. The financial summary
 * next door already costs seventeen Prisma calls and needed `maxDuration` raised
 * to 120s in vercel.json, so this screen has no budget to waste.
 *
 * One `$transaction` instead: the driver pipelines the batch over a single
 * connection, and the numbers are all read at one instant rather than drifting
 * apart as a check-in lands halfway through.
 *
 * Counts the caller may not act on are not computed at all. An accountant has no
 * `students.view`, so asking the database how many children are absent would be
 * work done to produce a line that gets filtered out before it reaches them.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const schoolId = session.user.schoolId;
  const held = session.permissions;
  const now = new Date();
  const dayStart = astDayStart(now);
  // Documented exclusive — paired with `lt`, never `lte`.
  const dayEnd = astDayEnd(now);

  const canStudents = grants(held, "students.view");
  const canFinance = grants(held, "finance.view");
  const canClasses = grants(held, "classes.view");
  const canCare = grants(held, "students.files");
  const canSettings = grants(held, "settings.manage");

  const [
    activeStudents,
    presentToday,
    unpaidInvoices,
    pendingEnrolments,
    classesWithoutTeacher,
    careReportsToday,
    expiringSoon,
    classCount,
    teacherCount,
    invitesSent,
    school,
  ] = await prisma.$transaction([
    canStudents
      ? prisma.student.count({ where: { schoolId, isActive: true } })
      : prisma.student.count({ where: { id: "" } }),

    canStudents
      ? prisma.attendance.count({
          where: { schoolId, checkinAt: { gte: dayStart, lt: dayEnd } },
        })
      : prisma.attendance.count({ where: { id: "" } }),

    // Payment state lives on the child, not on the invoice — an invoice here is
    // a document that was issued, with no status of its own.
    canFinance
      ? prisma.student.count({
          where: {
            schoolId,
            isActive: true,
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.LATE] },
          },
        })
      : prisma.student.count({ where: { id: "" } }),

    canStudents
      ? prisma.enrollmentSubmission.count({
          where: { school_id: schoolId, status: "pending_review" },
        })
      : prisma.enrollmentSubmission.count({ where: { id: "" } }),

    canClasses
      ? prisma.class.count({
          where: { schoolId, deletedAt: null, archivedAt: null, teacherId: null },
        })
      : prisma.class.count({ where: { id: "" } }),

    canCare
      ? prisma.careReport.count({
          where: { schoolId, createdAt: { gte: dayStart, lt: dayEnd } },
        })
      : prisma.careReport.count({ where: { id: "" } }),

    canStudents
      ? prisma.student.count({
          where: {
            schoolId,
            isActive: true,
            enrollmentEndDate: {
              gte: dayStart,
              // A month ahead: far enough to renew without rushing, near enough
              // that the line is not permanently lit.
              lt: new Date(dayStart.getTime() + 30 * 24 * 60 * 60 * 1000),
            },
          },
        })
      : prisma.student.count({ where: { id: "" } }),

    // The setup checklist. Cheap counts, and the owner is the only reader — but
    // running them unconditionally keeps the transaction one fixed shape.
    prisma.class.count({ where: { schoolId, deletedAt: null } }),
    prisma.teacher.count({ where: { schoolId, deletedAt: null } }),
    prisma.enrollmentToken.count({ where: { school_id: schoolId } }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { commercialRegistration: true, phoneNumber: true, logoUrl: true },
    }),
  ]);

  /**
   * Absent = enrolled today and not checked in.
   *
   * Clamped at zero: a child can be checked in after their enrolment ends, which
   * would otherwise render "-1 children absent".
   */
  const absent = Math.max(0, activeStudents - presentToday);

  const tasks = [
    canStudents && { key: "absent", count: absent, href: "/attendance" },
    canFinance && { key: "unpaidInvoices", count: unpaidInvoices, href: "/statistics" },
    canStudents && { key: "pendingEnrolments", count: pendingEnrolments, href: "/students" },
    canClasses && { key: "classesWithoutTeacher", count: classesWithoutTeacher, href: "/classes" },
    canCare && { key: "careReports", count: careReportsToday, href: "/care" },
    canStudents && { key: "expiringSoon", count: expiringSoon, href: "/students" },
  ].filter(Boolean);

  return Response.json({
    tasks,
    /**
     * Only the owner sees the checklist, and only until it is finished.
     *
     * `students.manage` is the proxy for "can act on any of these steps" — a
     * teacher shown "add your first class" would be shown work she cannot do.
     */
    setup: canSettings
      ? {
          steps: [
            { key: "schoolInfo", done: Boolean(school?.phoneNumber), href: "/settings" },
            { key: "firstClass", done: classCount > 0, href: "/classes" },
            { key: "firstTeacher", done: teacherCount > 0, href: "/teachers" },
            { key: "firstStudent", done: activeStudents > 0, href: "/students" },
            { key: "firstInvite", done: invitesSent > 0, href: "/students" },
          ],
        }
      : null,
  });
}
