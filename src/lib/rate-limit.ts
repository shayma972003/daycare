import { prisma } from "@/lib/prisma";

/**
 * Fixed-window rate limiting backed by the database.
 *
 * Serverless invocations share no memory, so an in-process counter would reset
 * on every cold start and enforce nothing. The window is keyed by an arbitrary
 * string, which lets the same primitive cover IP throttling, per-account
 * lockout, and per-resource send limits.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Seconds until the window resets. 0 when not limited. */
  retryAfter: number;
}

export interface RateLimitOptions {
  /** Stable identifier, e.g. `login:ip:1.2.3.4`. */
  key: string;
  /** Maximum attempts allowed inside the window. */
  limit: number;
  windowMs: number;
}

/** Best-effort client IP. Behind Vercel the left-most XFF entry is the caller. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function rateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);

  try {
    // Drop the previous window before counting, so an expired key starts fresh
    // instead of carrying its old total forward.
    await prisma.rateLimit.deleteMany({ where: { key, expiresAt: { lt: now } } });

    const record = await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt },
      update: { count: { increment: 1 } },
    });

    const remaining = Math.max(0, limit - record.count);
    const retryAfter = Math.max(
      0,
      Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000)
    );

    return { ok: record.count <= limit, remaining, retryAfter };
  } catch {
    // A limiter that errors must not become an outage. Failing open is the
    // deliberate trade-off: availability over throttling for a storage blip.
    console.error("[rate-limit] check failed, allowing request", key);
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/** Clears a window — call after a successful login so a lockout does not linger. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { key } });
  } catch {
    /* non-fatal */
  }
}

/** Standard 429 with a `Retry-After` header. */
export function tooManyRequests(retryAfter: number, message?: string): Response {
  return Response.json(
    {
      error:
        message ??
        `تم تجاوز عدد المحاولات المسموح بها. حاول مجدداً بعد ${Math.ceil(retryAfter / 60)} دقيقة.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

/** Removes expired windows. Called from the nightly cleanup job. */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
