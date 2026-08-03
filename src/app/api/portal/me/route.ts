import { prisma } from "@/lib/prisma";
import { bearerToken, verifyAccessToken } from "@/lib/mobile-auth";
import { guardianChildIds } from "@/lib/mobile-guard";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import { describeReport, CARE_TYPE_LABELS } from "@/lib/care-reports";
import { stampFileUrl } from "@/lib/file-token";

/**
 * Everything the parent portal's home screen needs, in one call (task 2.33).
 *
 * Deliberately one endpoint rather than six. The portal is mobile-first and
 * often opened on a phone at the school gate; six round trips on a poor
 * connection is a screen that assembles itself piece by piece over several
 * seconds.
 *
 * Authentication is the **same bearer token as the mobile app** — the portal is
 * the app's web face, not a second product, and giving it its own cookie session
 * would mean a second sign-in flow, a second revocation path and a second set of
 * mistakes to make.
 */
export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ error: "التوكن مفقود" }, { status: 401 });

  const claims = await verifyAccessToken(token);
  if (!claims || claims.kind !== "guardian") {
    return Response.json({ error: "غير مصرّح" }, { status: 401 });
  }

  const childIds = await guardianChildIds(claims.sub);
  if (childIds.length === 0) {
    return Response.json({ children: [], school: null });
  }

  const today = new Date();
  const dayStart = astDayStart(today);
  const dayEnd = astDayEnd(today);

  const [account, children, attendance, reports, events] = await Promise.all([
    prisma.guardianAccount.findUnique({
      where: { id: claims.sub },
      select: {
        guardian: { select: { name: true } },
        school: { select: { name: true, logoUrl: true, phoneNumber: true } },
      },
    }),
    prisma.student.findMany({
      where: { id: { in: childIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        period: true,
        academicStage: true,
        // Health data is included: this is the child's own parent, the one
        // person who already knows it and needs it on the emergency screen.
        allergies: true,
        healthCondition: true,
        enrollmentEndDate: true,
        paymentStatus: true,
        billingCycle: true,
        class: { select: { id: true, name: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { studentId: { in: childIds }, date: { gte: dayStart, lt: dayEnd } },
      select: {
        studentId: true,
        status: true,
        checkinAt: true,
        checkoutAt: true,
      },
    }),
    prisma.careReport.findMany({
      where: {
        studentId: { in: childIds },
        deletedAt: null,
        occurredAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { occurredAt: "desc" },
      take: 40,
      select: {
        id: true,
        studentId: true,
        type: true,
        occurredAt: true,
        note: true,
        photoUrl: true,
        mealName: true,
        mealAmount: true,
        napMinutes: true,
        toiletKind: true,
        toiletState: true,
        mood: true,
        medicationName: true,
        medicationDose: true,
        temperature: true,
        symptom: true,
        supplyItem: true,
        supplyQuantity: true,
      },
    }),
    // School-wide announcements and anything aimed at this child's room.
    prisma.calendarEvent.findMany({
      where: {
        schoolId: claims.schoolId,
        deletedAt: null,
        startAt: { gte: dayStart },
        OR: [{ classes: { none: {} } }, { classes: { some: {} } }],
      },
      orderBy: { startAt: "asc" },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        startAt: true,
        allDay: true,
        classes: { select: { classId: true } },
      },
    }),
  ]);

  const childClassIds = new Set(
    children.map((child) => child.class?.id).filter(Boolean) as string[]
  );

  /**
   * File URLs leave here with a grant attached.
   *
   * The portal authenticates with a bearer token held in JavaScript, and an
   * `<img>` tag cannot send one. This endpoint has just proved the guardian owns
   * these children, so it is the right place to convert that into something the
   * markup can use — a signature over one key, valid for minutes. See
   * src/lib/file-token.ts.
   */
  return Response.json({
    guardianName: account?.guardian.name ?? null,
    school: account?.school
      ? { ...account.school, logoUrl: stampFileUrl(account.school.logoUrl) }
      : null,
    children: children.map((child) => ({
      ...child,
      avatarUrl: stampFileUrl(child.avatarUrl),
      todayAttendance:
        attendance.find((record) => record.studentId === child.id) ?? null,
      todayReports: reports
        .filter((report) => report.studentId === child.id)
        .map((report) => ({
          id: report.id,
          type: report.type,
          typeLabel: CARE_TYPE_LABELS[report.type],
          summary: describeReport(report),
          occurredAt: report.occurredAt,
          note: report.note,
          photoUrl: stampFileUrl(report.photoUrl),
        })),
    })),
    // Filtered here rather than in SQL: "no rooms attached" means school-wide,
    // and expressing "either school-wide or one of my child's rooms" as a Prisma
    // filter is less readable than the two-line check it becomes here.
    events: events
      .filter(
        (event) =>
          event.classes.length === 0 ||
          event.classes.some((link) => childClassIds.has(link.classId))
      )
      .map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        startAt: event.startAt,
        allDay: event.allDay,
      })),
  });
}
