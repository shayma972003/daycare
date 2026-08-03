import { runAnonymizationSweep } from "@/lib/anonymization";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";

/**
 * Daily retention sweep. Scheduled in vercel.json at 03:00 UTC.
 *
 * Runs an hour after the trash purge so the two jobs never contend for the same
 * record — a student can be hard-deleted by the purge or anonymised by this job,
 * and interleaving them in one window would produce failures that look like data
 * loss.
 *
 * GET because Vercel Cron only issues GETs. The handler is idempotent in the way
 * that matters: `anonymizedAt` is the guard, so a second invocation on the same
 * day finds nothing due and clears nothing twice.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const ranAt = new Date();
  const result = await runAnonymizationSweep({ now: ranAt, executedBy: "SYSTEM" });

  return Response.json({
    success: true,
    ran_at: ranAt.toISOString(),
    ...result,
  });
}
