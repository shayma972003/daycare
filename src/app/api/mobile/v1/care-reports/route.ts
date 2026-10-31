import { prisma } from "@/lib/prisma";
import { requireMobileAuth, mobileAuthResponse, guardianChildIds } from "@/lib/mobile-guard";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import { describeReport, CARE_TYPE_LABELS } from "@/lib/care-reports";
import { stampFileUrl } from "@/lib/file-token";

/**
 * A guardian's view of their children's care reports.
 *
 * Read-only, and scoped through `guardianChildIds` — the one place the "your
 * children only" rule is expressed. A `studentId` in the query string is
 * intersected with that list rather than trusted: the parameter narrows the
 * result, it never widens it.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "guardian" });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const allowedIds = await guardianChildIds(context.claims.sub);
  if (allowedIds.length === 0) return Response.json([]);

  const url = new URL(request.url);
  const requested = url.searchParams.get("studentId");
  const date = url.searchParams.get("date");

  // Intersection, not substitution.
  const studentIds =
    requested && allowedIds.includes(requested) ? [requested] : allowedIds;

  const day = date ? new Date(date) : null;
  const validDay = day && !Number.isNaN(day.getTime()) ? day : null;

  const reportScope = {
    schoolId: context.schoolId,
    deletedAt: null,
    reviewStatus: "APPROVED" as const,
    ...(validDay
      ? { occurredAt: { gte: astDayStart(validDay), lt: astDayEnd(validDay) } }
      : {}),
  };

  /**
   * The guardian app is a current hand-off, not the permanent care archive.
   * Keep the newest complete submission for every linked child on screen until
   * a newer approved submission replaces it. A unified daily form is stored as
   * several rows sharing `dailyBatchId`, so selecting only the newest row would
   * silently drop the meal, nap, mood, or toilet details beside it.
   *
   * The rows themselves are never deleted here. Managers continue to see the
   * complete history from the student's profile in the dashboard.
   */
  const latestSubmissions = (
    await Promise.all(
      studentIds.map((studentId) =>
        prisma.careReport.findFirst({
          where: { ...reportScope, studentId },
          // A newer submission must replace the previous batch as a whole.
          // `occurredAt` belongs to each individual section (meal, nap, etc.),
          // so ordering by it first can accidentally revive sections from an
          // older batch when one of those sections has a later event time.
          orderBy: [{ createdAt: "desc" }, { occurredAt: "desc" }],
          select: { id: true, studentId: true, dailyBatchId: true },
        })
      )
    )
  ).filter((report): report is NonNullable<typeof report> => report !== null);

  if (latestSubmissions.length === 0) return Response.json([]);

  const reports = await prisma.careReport.findMany({
    where: {
      ...reportScope,
      OR: latestSubmissions.map((report) =>
        report.dailyBatchId
          ? { studentId: report.studentId, dailyBatchId: report.dailyBatchId }
          : { studentId: report.studentId, id: report.id }
      ),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      note: true,
      photoUrl: true,
      reportedByName: true,
      mealSource: true,
      mealName: true,
      mealAmount: true,
      napMinutes: true,
      napQuality: true,
      toiletKind: true,
      toiletState: true,
      mood: true,
      medicationName: true,
      medicationDose: true,
      temperature: true,
      symptom: true,
      supplyItem: true,
      supplyQuantity: true,
      student: { select: { id: true, name: true } },
    },
  });

  return Response.json(
    reports.map((report) => ({
      ...report,
      // A grant per photo, so an image component that cannot attach a bearer
      // header still loads it. See src/lib/file-token.ts.
      photoUrl: stampFileUrl(report.photoUrl),
      typeLabel: CARE_TYPE_LABELS[report.type],
      summary: describeReport(report),
    }))
  );
}
