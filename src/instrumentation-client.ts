/**
 * Browser-side error tracking.
 *
 * Runs before the app becomes interactive. Unlike the server hook this file
 * exports nothing — Next executes it directly. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md.
 *
 * Wrapped in try/catch on the Next docs' own advice: a monitoring failure must
 * not be the thing that stops the page loading.
 */

import * as Sentry from "@sentry/nextjs";
import { SENTRY_SHARED_OPTIONS } from "@/lib/sentry-options";

try {
  Sentry.init({
    ...SENTRY_SHARED_OPTIONS,
    /**
     * No session replay.
     *
     * Replay records the DOM — which on these screens means children's names,
     * health notes and guardians' phone numbers, sent to a third party. The
     * feature is genuinely useful and is simply not appropriate for this
     * product.
     */
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
} catch (error) {
  console.error("[sentry] client init failed:", error);
}

/** Instruments client-side navigations so an error carries the route it came from. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
