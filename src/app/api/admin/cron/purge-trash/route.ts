import { cleanupExpiredTrash } from "@/lib/trash-cleanup";
import { deleteExpiredImportSessions } from "@/lib/import-cleanup";
import { deactivateAllExpiredExpenses } from "@/lib/expense-updater";
import { syncAllExpenseOccurrences } from "@/lib/expense-occurrences";
import { purgeExpiredRateLimits } from "@/lib/rate-limit";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";
import { refreshStorageUsage } from "@/lib/storage-usage";
import { prisma } from "@/lib/prisma";
import {
  cleanupEnrollmentStoredFiles,
  purgeExpiredEnrollmentTokens,
} from "@/lib/stored-files";
import { runBoundedRetention } from "@/lib/bounded-retention";
import { logSafeError } from "@/lib/safe-logger";

/** Nightly housekeeping. Scheduled in vercel.json. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const now = new Date();
  const trash = await cleanupExpiredTrash();
  const importSessions = await deleteExpiredImportSessions();
  const rateLimits = await purgeExpiredRateLimits();
  // Moved off the financial-report path, where it made a read mutate rows and
  // let two concurrent reports race each other.
  const expensesStopped = await deactivateAllExpiredExpenses();
  const expenseOccurrencesCreated = await syncAllExpenseOccurrences(now);

  // These two tables grew without bound: nothing ever removed a spent 2FA
  // session or an expired enrolment link.
  const retention = await runBoundedRetention(now);
  const enrollmentFiles = await cleanupEnrollmentStoredFiles({ now, limit: 100 });
  const enrollmentTokens = await purgeExpiredEnrollmentTokens({ now, limit: 100 });

  /**
   * Storage figures, recomputed after the purge rather than before.
   *
   * This job has just deleted rows, so running it here means the cached number a
   * school sees tomorrow reflects the space that was actually freed — computing
   * first would report yesterday's total and make the purge look like it did
   * nothing.
   *
   * Isolated per school: one tenant with a malformed row must not stop the rest
   * of the platform's figures updating.
   */
  const schools = await prisma.school.findMany({ select: { id: true } });
  let storageComputed = 0;
  let storageFailures = 0;
  for (const school of schools) {
    try {
      await refreshStorageUsage(school.id);
      storageComputed++;
    } catch (error) {
      storageFailures++;
      logSafeError("purge-trash-storage-usage", error);
    }
  }

  return Response.json({
    success: true,
    ran_at: now.toISOString(),
    trash,
    importSessions,
    rateLimits,
    expensesStopped,
    expenseOccurrencesCreated,
    retention,
    enrollmentFiles,
    enrollmentTokens,
    storageComputed,
    storageFailures,
  });
}
