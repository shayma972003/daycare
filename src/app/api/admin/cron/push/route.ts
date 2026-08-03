import { drainPushQueue } from "@/lib/push";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";

/**
 * Drains the push queue.
 *
 * Scheduled every five minutes in vercel.json. Five rather than one because a
 * notification arriving four minutes late is unremarkable to a parent, while a
 * cron running twelve times as often costs twelve times as many invocations for
 * the same throughput.
 *
 * Idempotent: only PENDING rows within their attempt budget are picked up, so an
 * overlapping run finds nothing to redo.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const ranAt = new Date();
  const result = await drainPushQueue();

  return Response.json({ success: true, ran_at: ranAt.toISOString(), ...result });
}
