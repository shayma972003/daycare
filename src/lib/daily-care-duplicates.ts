import { Prisma } from "@/generated/prisma/client";
import { astDayEnd, astDayStart } from "@/lib/datetime";

export class DailyCareAlreadySubmittedError extends Error {
  readonly studentIds: string[];

  constructor(studentIds: string[]) {
    super("DAILY_REPORT_ALREADY_SUBMITTED");
    this.name = "DailyCareAlreadySubmittedError";
    this.studentIds = studentIds;
  }
}

/**
 * Serializes daily-report creation per child, then rejects any second batch on
 * the same Riyadh calendar day. Returned batches use their dedicated resubmit
 * route and therefore remain editable without opening a second daily report.
 */
export async function assertNoDailyCareReportsToday(
  tx: Prisma.TransactionClient,
  schoolId: string,
  studentIds: string[],
  now = new Date()
) {
  const uniqueStudentIds = [...new Set(studentIds)].sort();
  if (uniqueStudentIds.length === 0) return;

  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "Student"
    WHERE "schoolId" = ${schoolId}
      AND "id" IN (${Prisma.join(uniqueStudentIds)})
    ORDER BY "id"
    FOR UPDATE
  `);

  const existing = await tx.careReport.findMany({
    where: {
      schoolId,
      studentId: { in: uniqueStudentIds },
      dailyBatchId: { not: null },
      deletedAt: null,
      createdAt: { gte: astDayStart(now), lt: astDayEnd(now) },
    },
    distinct: ["studentId"],
    select: { studentId: true },
  });

  if (existing.length > 0) {
    throw new DailyCareAlreadySubmittedError(existing.map((row) => row.studentId));
  }
}
