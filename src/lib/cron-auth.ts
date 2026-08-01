import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

/**
 * Authorises a scheduled job invocation.
 *
 * The routes used to require a custom `x-cron-secret` header, which Vercel Cron
 * cannot send — it only sets `Authorization: Bearer $CRON_SECRET`. Every
 * scheduled run therefore returned 401 and the jobs silently never ran. Both
 * forms are accepted now so a manual curl still works.
 *
 * Fails closed when CRON_SECRET is unset: an unauthenticated endpoint that can
 * permanently delete records is worse than a job that does not run.
 */
export function isAuthorizedCron(request: Request): boolean {
  const expected = env.CRON_SECRET;
  if (!expected) return false;

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : null;

  const provided = bearer ?? request.headers.get("x-cron-secret");
  if (!provided) return false;

  return constantTimeEquals(provided, expected);
}

/** Avoids leaking the secret one character at a time through response timing. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function cronUnauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
