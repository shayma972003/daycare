import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting (task 1.15).
 *
 * One function every error path calls. That seam was the point of writing this
 * before a provider was chosen — swapping in Sentry was an edit here rather than
 * a hunt through a hundred `console.error` calls.
 *
 * Three destinations, all optional and independent:
 *
 * - **Sentry** — the real one. Groups repeats, keeps stack traces and history.
 *   Configured in `instrumentation.ts` / `instrumentation-client.ts`; privacy
 *   settings live in `sentry-options.ts`.
 * - **`ERROR_WEBHOOK_URL`** — any endpoint accepting JSON (a Slack webhook, say).
 *   Kept because a chat notification is what actually gets *noticed*, while
 *   Sentry is where you go to investigate.
 * - **stdout** — always, so a developer with neither configured still sees
 *   everything.
 *
 * Nothing here throws. A monitoring outage that takes down the routes it is
 * watching is worse than no monitoring at all.
 */

export type Severity = "warning" | "error" | "fatal";

export interface ErrorContext {
  /** Where it happened — a route path or a job name. */
  scope: string;
  schoolId?: string | null;
  userId?: string | null;
  /** Anything that helps diagnose. Never PII: this leaves the system. */
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * Reports an error without ever throwing.
 *
 * Deliberately not awaited by callers, and swallowing its own failures: a
 * monitoring outage that takes down the routes it is watching is worse than no
 * monitoring at all.
 */
export function reportError(
  error: unknown,
  context: ErrorContext,
  severity: Severity = "error"
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Always logged, whether or not anything else is configured. Vercel keeps
  // stdout, so this is the baseline that works with no setup at all.
  console.error(`[${severity}] ${context.scope}: ${message}`, {
    schoolId: context.schoolId ?? undefined,
    ...context.extra,
  });

  /**
   * Sentry.
   *
   * Tags rather than free-form context for `scope` and `schoolId`: tags are
   * filterable, so "every failure in the anonymisation sweep" or "everything
   * wrong at this one nursery" is a query rather than a search through bodies.
   *
   * The id only — never the name or the email. `sentry-options.ts` strips those
   * as a second line of defence, but the right place not to send them is here,
   * where they are never attached in the first place.
   */
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(severity === "warning" ? "warning" : severity === "fatal" ? "fatal" : "error");
      scope.setTag("scope", context.scope);
      if (context.schoolId) scope.setTag("schoolId", context.schoolId);
      if (context.userId) scope.setUser({ id: context.userId });
      if (context.extra) scope.setContext("extra", context.extra);

      // A real Error keeps its stack; anything else is captured as a message so
      // a thrown string still reaches Sentry rather than being dropped.
      if (error instanceof Error) Sentry.captureException(error);
      else Sentry.captureMessage(`${context.scope}: ${message}`);
    });
  } catch (sentryError) {
    console.error("[monitoring] sentry capture failed:", sentryError);
  }

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  const payload = {
    severity,
    scope: context.scope,
    message,
    // Truncated: a full stack in a webhook body is mostly framework frames, and
    // some receivers reject large payloads outright.
    stack: stack?.split("\n").slice(0, 12).join("\n"),
    schoolId: context.schoolId ?? null,
    // The id, never the name or email. An alerting channel is not a place to put
    // personal data — see docs/DATA_LIFECYCLE.md.
    userId: context.userId ?? null,
    extra: context.extra ?? {},
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
  };

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((sendError) => {
    console.error("[monitoring] failed to deliver report:", sendError);
  });
}

/**
 * Wraps a scheduled job so a crash is reported rather than lost.
 *
 * Cron failures are the ones that go unnoticed longest: nobody is watching, and
 * the only symptom is work quietly not happening — which is exactly how the
 * trash purge managed to do nothing for months.
 */
export async function withMonitoring<T>(
  scope: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    reportError(error, { scope }, "fatal");
    throw error;
  }
}
