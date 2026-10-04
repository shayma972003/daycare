import { prisma } from "@/lib/prisma";
import { notifyGuardiansOfReport } from "@/lib/care-report-notify";
import { logSafeError } from "@/lib/safe-logger";

export type CareReportSubmissionStatus = "PENDING_REVIEW" | "APPROVED";

export async function loadCareReportPolicy(schoolId: string) {
  const settings = await prisma.settings.findUnique({
    where: { schoolId },
    select: { careReportReviewRequired: true },
  });
  return { reviewRequired: settings?.careReportReviewRequired ?? true };
}

export function careReportSubmissionFields(
  reviewRequired: boolean,
  now = new Date()
) {
  if (reviewRequired) {
    return {
      reviewStatus: "PENDING_REVIEW" as const,
      reviewedAt: null,
      reviewedById: null,
      reviewedByName: null,
      reviewNote: null,
      guardianNotifiedAt: null,
    };
  }
  return {
    reviewStatus: "APPROVED" as const,
    reviewedAt: now,
    reviewedById: null,
    reviewedByName: "إرسال مباشر حسب إعداد المنشأة",
    reviewNote: null,
    guardianNotifiedAt: null,
  };
}

export async function notifyApprovedCareReports(
  schoolId: string,
  reportIds: string[],
  status: CareReportSubmissionStatus
) {
  if (status !== "APPROVED" || reportIds.length === 0) return 0;
  try {
    return await notifyGuardiansOfReport(schoolId, reportIds);
  } catch (error) {
    // The report is already safely stored and visible in the authenticated
    // guardian feed. A transient push failure must not make the teacher retry
    // and create a duplicate report.
    logSafeError("care-report-direct-notify", error);
    return 0;
  }
}
