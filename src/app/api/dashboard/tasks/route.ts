import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { calendarToday, localDayBounds, requestTimeZone } from "@/lib/device-date";
import { subscriptionFilterWhere } from "@/lib/student-lifecycle";
import { withNoStore } from "@/lib/auth-response";
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
 * These are independent read-only counters. Run them concurrently rather than
 * holding one database transaction open across a remote Neon connection: a
 * slow cold start must not turn a harmless dashboard read into a P2028 timeout.
 *
 * Counts the caller may not act on are not computed at all. An accountant has no
 * `students.view`, so asking the database how many children are absent would be
 * work done to produce a line that gets filtered out before it reaches them.
 */
export async function GET(request: Request) {
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
  let timeZone: string;
  try { timeZone = requestTimeZone(request); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }
  const today = calendarToday(now, timeZone);
  const { start: dayStart, end: dayEnd } = localDayBounds(now, timeZone);

  const canStudents = grants(held, "students.view");
  const canFinance = grants(held, "finance.view");
  const canClasses = grants(held, "classes.view");
  const canCare = grants(held, "students.files");
  const canSettings = grants(held, "settings.manage");

  const [
    activeStudents,
    presentToday,
    eligiblePresentToday,
    unpaidInvoices,
    pendingEnrolments,
    classesWithoutTeacher,
    careReportsToday,
    expiringSoon,
    expiredSubscriptions,
    classCount,
    teacherCount,
    invitesSent,
    school,
  ] = await Promise.all([
    canStudents
      ? prisma.student.count({ where: { schoolId, deletedAt: null, isActive: true, status: "ACTIVE", ...subscriptionFilterWhere("current", today) } })
      : prisma.student.count({ where: { id: "" } }),

    canStudents
      ? prisma.attendance.count({
          where: {
            schoolId,
            checkinAt: { gte: dayStart, lt: dayEnd },
          },
        })
      : prisma.attendance.count({ where: { id: "" } }),

    canStudents
      ? prisma.attendance.count({
          where: {
            schoolId,
            checkinAt: { gte: dayStart, lt: dayEnd },
            student: {
              is: {
                schoolId,
                deletedAt: null,
                isActive: true,
                status: "ACTIVE",
                ...subscriptionFilterWhere("current", today),
              },
            },
          },
        })
      : prisma.attendance.count({ where: { id: "" } }),

    // Payment state lives on the child, not on the invoice — an invoice here is
    // a document that was issued, with no status of its own.
    canFinance
      ? prisma.student.count({
          where: {
            schoolId,
            isActive: true,
            ...subscriptionFilterWhere("current", today),
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
            deletedAt: null,
            ...subscriptionFilterWhere("expiring", today),
          },
        })
      : prisma.student.count({ where: { id: "" } }),

    canStudents
      ? prisma.student.count({
          where: { schoolId, deletedAt: null, ...subscriptionFilterWhere("expired", today) },
        })
      : prisma.student.count({ where: { id: "" } }),

    // Only the owner can see or act on the setup checklist.
    canSettings ? prisma.class.count({ where: { schoolId, deletedAt: null } }) : Promise.resolve(0),
    canSettings ? prisma.teacher.count({ where: { schoolId, deletedAt: null } }) : Promise.resolve(0),
    canSettings ? prisma.enrollmentToken.count({ where: { school_id: schoolId } }) : Promise.resolve(0),
    canSettings
      ? prisma.school.findUnique({
          where: { id: schoolId },
          select: { commercialRegistration: true, phoneNumber: true, logoUrl: true },
        })
      : Promise.resolve(null),
  ]);

  /**
   * Absent = currently eligible today and not checked in. Historical check-ins
   * remain in `presentToday` but do not change this operational denominator.
   */
  // `presentToday` is historical truth for the day. A child who checked in and
  // was later suspended/expired remains counted. Absence is an operational
  // metric, so only currently eligible children belong in its denominator.
  const absent = Math.max(0, activeStudents - eligiblePresentToday);

  const tasks = [
    canStudents && { key: "absent", count: absent, href: "/attendance" },
    canFinance && { key: "unpaidInvoices", count: unpaidInvoices, href: "/statistics" },
    canStudents && { key: "pendingEnrolments", count: pendingEnrolments, href: "/students" },
    canClasses && { key: "classesWithoutTeacher", count: classesWithoutTeacher, href: "/classes" },
    canCare && { key: "careReports", count: careReportsToday, href: "/care" },
    canStudents && { key: "expiringSoon", count: expiringSoon, href: "/students?subscription=expiring" },
    canStudents && { key: "expiredSubscriptions", count: expiredSubscriptions, href: "/students?subscription=expired" },
  ].filter(Boolean);

  return withNoStore(Response.json({
    tasks,
    // Historical truth for today's check-ins; unlike `absent`, this does not
    // apply the current roster eligibility filter.
    presentToday,
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
  }));
}
