import { prisma } from "@/lib/prisma";
import { enqueuePush } from "@/lib/push";
import { CARE_TYPE_LABELS, describeReport } from "@/lib/care-reports";
import { logSafeError } from "@/lib/safe-logger";

/**
 * Immediate push when a report is filed (task 2.8).
 *
 * Queued, not sent: `enqueuePush` writes rows and the five-minute worker
 * delivers them. The teacher's request returns as soon as the report is saved.
 *
 * **The notification never carries the report's contents.** It says a report
 * exists and which child it concerns. A push payload is rendered on a lock
 * screen, retained in the provider's logs, and passes through Google's or
 * Huawei's infrastructure — none of which is a place for a child's temperature
 * or medication. The app fetches the detail over an authenticated call.
 */
export async function notifyGuardiansOfReport(
  schoolId: string,
  reportIds: string[]
): Promise<number> {
  if (reportIds.length === 0) return 0;

  const reports = await prisma.careReport.findMany({
    where: {
      id: { in: reportIds },
      schoolId,
      deletedAt: null,
      reviewStatus: "APPROVED",
      guardianNotifiedAt: null,
    },
    select: {
      id: true,
      type: true,
      studentId: true,
      student: {
        select: {
          name: true,
          guardianId: true,
          guardianLinks: { select: { guardianId: true } },
        },
      },
    },
  });

  let queued = 0;
  const byStudent = new Map<string, typeof reports>();
  for (const report of reports) {
    const bucket = byStudent.get(report.studentId) ?? [];
    bucket.push(report);
    byStudent.set(report.studentId, bucket);
  }

  for (const studentReports of byStudent.values()) {
    const first = studentReports[0];
    const guardianIds = new Set<string>();
    if (first.student.guardianId) guardianIds.add(first.student.guardianId);
    for (const link of first.student.guardianLinks) guardianIds.add(link.guardianId);
    const accounts = guardianIds.size === 0 ? [] : await prisma.guardianAccount.findMany({
      where: {
        schoolId,
        guardianId: { in: [...guardianIds] },
        acceptedAt: { not: null },
        disabledAt: null,
        guardian: { is: { schoolId, deletedAt: null, anonymizedAt: null } },
      },
      select: { id: true },
    });

    for (const account of accounts) {
      try {
        queued += await enqueuePush(
          { schoolId, guardianAccountId: account.id },
          {
            title: first.student.name,
            body: studentReports.length === 1
              ? `تقرير جديد: ${CARE_TYPE_LABELS[first.type]}`
              : `تم اعتماد تقرير الرعاية اليومي (${studentReports.length} بنود)`,
            data: {
              kind: "care_report",
              reportId: first.id,
              studentId: first.studentId,
            },
          }
        );
      } catch (error) {
        logSafeError("care-report-approved-push", error);
      }
    }

    if (accounts.length > 0) {
      await prisma.careReport.updateMany({
        where: {
          id: { in: studentReports.map((report) => report.id) },
          schoolId,
          guardianNotifiedAt: null,
        },
        data: { guardianNotifiedAt: new Date() },
      });
    }
  }

  return queued;
}

/**
 * Builds one guardian's end-of-day summary (task 2.7).
 *
 * Grouped by child, then by report type, in the order the day happened. A flat
 * list of twenty lines is technically the same information and is not what a
 * parent reads at 16:00.
 */
export type SummaryReport = Parameters<typeof describeReport>[0] & {
  occurredAt: Date;
  note: string | null;
};

export interface ChildSummary {
  studentName: string;
  reports: SummaryReport[];
}

export function renderDailySummary(
  schoolName: string,
  children: ChildSummary[]
): string {
  const lines: string[] = [`ملخص اليوم من ${schoolName}`, ""];

  for (const child of children) {
    lines.push(`— ${child.studentName} —`);
    for (const report of child.reports) {
      const time = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit",
      }).format(report.occurredAt);
      // The full line here, unlike the push: this is an authenticated inbox the
      // guardian owns, not a lock screen.
      lines.push(`${time} · ${CARE_TYPE_LABELS[report.type]}: ${describeReport(report)}`);
      if (report.note && report.type !== "GENERAL") lines.push(`   ${report.note}`);
    }
    lines.push("");
  }

  lines.push("لمزيد من التفاصيل، افتحي البوابة أو التطبيق.");
  return lines.join("\n");
}
