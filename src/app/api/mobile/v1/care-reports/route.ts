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

  const reports = await prisma.careReport.findMany({
    where: {
      studentId: { in: studentIds },
      // Belt and braces: the child ids already imply the tenant, but a report is
      // the most privacy-sensitive row in the product.
      schoolId: context.schoolId,
      deletedAt: null,
      ...(validDay
        ? { occurredAt: { gte: astDayStart(validDay), lt: astDayEnd(validDay) } }
        : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      note: true,
      photoUrl: true,
      reportedByName: true,
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
