/**
 * Server and edge startup hook.
 *
 * Next calls `register()` once per server instance, in every runtime, so the
 * imports are conditional on `NEXT_RUNTIME` — the Node build of the Sentry SDK
 * does not run on the edge and vice versa.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/instrumentation.md.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    const { SENTRY_SHARED_OPTIONS } = await import("@/lib/sentry-options");
    Sentry.init(SENTRY_SHARED_OPTIONS);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    const { SENTRY_SHARED_OPTIONS } = await import("@/lib/sentry-options");
    Sentry.init(SENTRY_SHARED_OPTIONS);
  }
}

/**
 * Reports errors thrown while rendering a request on the server.
 *
 * Without this hook, a failure inside a server component is logged by Next and
 * never reaches Sentry — which is the half of the app most likely to touch the
 * database.
 */
export async function onRequestError(
  ...args: Parameters<
    NonNullable<typeof import("@sentry/nextjs")["captureRequestError"]>
  >
) {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
