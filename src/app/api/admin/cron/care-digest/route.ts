import { sendDailyDigests } from "@/lib/care-report-digest";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";
import { withMonitoring } from "@/lib/monitoring";

/**
 * End-of-day care summary for guardians.
 *
 * Scheduled at 14:00 UTC — 17:00 in Riyadh, after the latest checkout time a
 * nursery is likely to use, so the day is complete when the message goes out.
 * A summary that arrives before the child is collected is not a summary.
 *
 * Idempotent through `summarizedAt`: a retry finds nothing left to send.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const ranAt = new Date();
  const result = await withMonitoring("cron/care-digest", () => sendDailyDigests(ranAt));

  return Response.json({ success: true, ran_at: ranAt.toISOString(), ...result });
}
