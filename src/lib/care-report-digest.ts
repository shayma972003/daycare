import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import { renderDailySummary, type ChildSummary } from "@/lib/care-report-notify";

/**
 * End-of-day summary email, one per guardian (task 2.7).
 *
 * Per guardian rather than per child: a family with two children in the nursery
 * gets one message covering both. Two separate emails at the same minute is how
 * a product teaches parents to ignore it.
 *
 * `summarizedAt` marks what has already been sent, so a re-run — a retry, an
 * overlapping cron, a manual trigger — does not send the day twice. That flag is
 * the whole idempotency mechanism.
 */

/** Bounded per run so one invocation cannot exceed the function timeout. */
const MAX_GUARDIANS = 300;

export interface DigestResult {
  guardians: number;
  reports: number;
  failures: number;
}

export async function sendDailyDigests(now: Date = new Date()): Promise<DigestResult> {
  const result: DigestResult = { guardians: 0, reports: 0, failures: 0 };

  const dayStart = astDayStart(now);
  const dayEnd = astDayEnd(now);

  const reports = await prisma.careReport.findMany({
    where: {
      deletedAt: null,
      summarizedAt: null,
      occurredAt: { gte: dayStart, lt: dayEnd },
      // A supplies request is addressed to the parent already and is not part of
      // "how was my child's day".
      type: { not: "SUPPLIES" },
    },
    orderBy: { occurredAt: "asc" },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          guardianId: true,
          guardian: { select: { id: true, name: true, email: true } },
        },
      },
      school: { select: { id: true, name: true } },
    },
  });

  if (reports.length === 0) return result;

  // Grouped in memory rather than by a series of queries: the day's reports for
  // one nursery are a few hundred rows at most, and the alternative is a query
  // per guardian.
  const byGuardian = new Map<
    string,
    {
      email: string;
      schoolName: string;
      children: Map<string, ChildSummary>;
      reportIds: string[];
    }
  >();

  for (const report of reports) {
    const guardian = report.student.guardian;
    // No guardian, or no address to send to. The report stays unsummarised so it
    // is picked up if contact details are added later.
    if (!guardian?.email) continue;

    let bucket = byGuardian.get(guardian.id);
    if (!bucket) {
      bucket = {
        email: guardian.email,
        schoolName: report.school?.name ?? "الحضانة",
        children: new Map(),
        reportIds: [],
      };
      byGuardian.set(guardian.id, bucket);
    }

    let child = bucket.children.get(report.student.id);
    if (!child) {
      child = { studentName: report.student.name, reports: [] };
      bucket.children.set(report.student.id, child);
    }

    child.reports.push(report);
    bucket.reportIds.push(report.id);
  }

  let processed = 0;

  for (const bucket of byGuardian.values()) {
    if (processed >= MAX_GUARDIANS) break;
    processed++;

    const body = renderDailySummary(bucket.schoolName, [...bucket.children.values()]);

    try {
      const sent = await sendEmail(
        bucket.email,
        `ملخص يوم ${bucket.schoolName}`,
        body,
        bucket.schoolName
      );

      if (!sent.success) {
        result.failures++;
        // Left unsummarised deliberately: a transient mail failure should be
        // retried, not silently swallow a parent's whole day.
        continue;
      }

      await prisma.careReport.updateMany({
        where: { id: { in: bucket.reportIds } },
        data: { summarizedAt: new Date() },
      });

      result.guardians++;
      result.reports += bucket.reportIds.length;
    } catch (error) {
      // Isolated per guardian: one bad address must not stop the rest of the
      // nursery's parents receiving theirs.
      result.failures++;
      console.error("[care-digest] guardian failed:", error);
    }
  }

  console.log("[care-digest] done:", result);
  return result;
}
