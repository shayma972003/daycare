import { drainPushQueue } from "@/lib/push";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";

/**
 * Drains the push queue.
 *
 * Scheduled daily in vercel.json as a durable recovery sweep. Normal
 * request-triggered notifications are drained after the originating response,
 * while this worker catches provider retries, interrupted background work, and
 * unusually large queues without requiring a paid high-frequency cron plan.
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
