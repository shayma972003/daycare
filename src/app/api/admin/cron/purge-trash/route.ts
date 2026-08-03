import { cleanupExpiredTrash } from "@/lib/trash-cleanup";
import { deleteExpiredImportSessions } from "@/lib/import-cleanup";
import { deactivateAllExpiredExpenses } from "@/lib/expense-updater";
import { purgeExpiredRateLimits } from "@/lib/rate-limit";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";
import { refreshStorageUsage } from "@/lib/storage-usage";
import { prisma } from "@/lib/prisma";

/** Nightly housekeeping. Scheduled in vercel.json. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const trash = await cleanupExpiredTrash();
  const importSessions = await deleteExpiredImportSessions();
  const rateLimits = await purgeExpiredRateLimits();
  // Moved off the financial-report path, where it made a read mutate rows and
  // let two concurrent reports race each other.
  const expensesStopped = await deactivateAllExpiredExpenses();

  // These two tables grew without bound: nothing ever removed a spent 2FA
  // session or an expired enrolment link.
  const now = new Date();
  const { count: twoFaSessions } = await prisma.twoFASession.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const { count: enrollmentTokens } = await prisma.enrollmentToken.deleteMany({
    where: { expires_at: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
  });

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
      console.error(`[purge-trash] storage usage failed for ${school.id}:`, error);
    }
  }

  return Response.json({
    success: true,
    ran_at: now.toISOString(),
    trash,
    importSessions,
    rateLimits,
    expensesStopped,
    twoFaSessions,
    enrollmentTokens,
    storageComputed,
    storageFailures,
  });
}
