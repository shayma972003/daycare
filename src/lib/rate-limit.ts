import { prisma } from "@/lib/prisma";

/**
 * Fixed-window rate limiting backed by the database.
 *
 * Serverless invocations share no memory, so an in-process counter would reset
 * on every cold start and enforce nothing. The window is keyed by an arbitrary
 * string, which lets the same primitive cover IP throttling, per-account
 * lockout, and per-resource send limits.
 */

export type RateLimitResult =
  | {
      status: "allowed";
      /** Attempts left in the current window. */
      remaining: number;
      retryAfter: 0;
    }
  | {
      status: "limited";
      remaining: 0;
      /** Seconds until the current window resets. */
      retryAfter: number;
    }
  | {
      status: "unavailable";
      remaining: 0;
      /** Short delay before the caller may retry the unavailable store. */
      retryAfter: number;
    };

export type RateLimitResetResult =
  | { status: "reset" }
  | { status: "unavailable" };

export interface RateLimitOptions {
  /** Stable identifier, e.g. `login:ip:1.2.3.4`. */
  key: string;
  /** Maximum attempts allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResponseOptions {
  limitedMessage?: string;
  unavailableMessage?: string;
}

export const RATE_LIMIT_STORE_RETRY_AFTER_SECONDS = 10;

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

    if (record.count <= limit) {
      return {
        status: "allowed",
        remaining: Math.max(0, limit - record.count),
        retryAfter: 0,
      };
    }

    return {
      status: "limited",
      remaining: 0,
      retryAfter: Math.max(
        1,
        Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000)
      ),
    };
  } catch {
    // Never log `key`: it may contain an email address, IP, or resource id.
    // Authentication and invitation endpoints must fail closed when their
    // shared store cannot enforce a limit.
    console.error("[rate-limit] store unavailable during check");
    return {
      status: "unavailable",
      remaining: 0,
      retryAfter: RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
    };
  }
}

/** Clears a window — call after a successful login so a lockout does not linger. */
export async function resetRateLimit(key: string): Promise<RateLimitResetResult> {
  try {
    await prisma.rateLimit.deleteMany({ where: { key } });
    return { status: "reset" };
  } catch {
    // Reset failure must be observable to tests/telemetry but must not expose
    // the sensitive key or undo an otherwise successful authentication.
    console.error("[rate-limit] store unavailable during reset");
    return { status: "unavailable" };
  }
}

/** Standard 429 with a `Retry-After` header. */
export function tooManyRequests(retryAfter: number, message?: string): Response {
  message ??= "تم تجاوز عدد المحاولات المسموح بها. حاول مجددًا لاحقًا.";
  return Response.json(
    {
      error:
        message ??
        `تم تجاوز عدد المحاولات المسموح بها. حاول مجدداً بعد ${Math.ceil(retryAfter / 60)} دقيقة.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

/** Standard 503 used when the shared limiter store cannot make a decision. */
export function rateLimitUnavailable(retryAfter: number, message?: string): Response {
  return Response.json(
    {
      error: message ?? "الخدمة غير متاحة مؤقتًا. حاول مجددًا بعد قليل.",
    },
    { status: 503, headers: { "Retry-After": String(retryAfter) } }
  );
}

/** Converts a limiter decision into the HTTP response a route should return. */
export function rateLimitResponse(
  result: RateLimitResult,
  options: RateLimitResponseOptions = {}
): Response | null {
  if (result.status === "allowed") return null;
  if (result.status === "limited") {
    return tooManyRequests(result.retryAfter, options.limitedMessage);
  }
  return rateLimitUnavailable(result.retryAfter, options.unavailableMessage);
}

/** Fails a login closed when its successful-login counter cannot be cleared. */
export function rateLimitResetResponse(
  result: RateLimitResetResult,
  unavailableMessage?: string
): Response | null {
  if (result.status === "reset") return null;
  return rateLimitUnavailable(
    RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
    unavailableMessage
  );
}

/** Removes expired windows. Called from the nightly cleanup job. */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
