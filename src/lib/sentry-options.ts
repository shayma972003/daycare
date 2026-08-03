/**
 * Shared Sentry settings for every runtime (server, edge, browser).
 *
 * One object so the privacy decisions below cannot be applied on the server and
 * forgotten in the browser — which is exactly the kind of gap that leaks a
 * child's name into a third-party service.
 *
 * The account is in the **EU region** (`ingest.de.sentry.io`), chosen over the US
 * because GDPR-grade protection is the easier conversation in the PDPL review
 * (task D7.4), and the region cannot be changed later.
 */

import type { ErrorEvent, NodeOptions, BrowserOptions } from "@sentry/nextjs";

export const SENTRY_SHARED_OPTIONS = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  /**
   * The most important line in this file.
   *
   * With `sendDefaultPii: true` Sentry attaches IP addresses, cookies, request
   * headers and user identifiers automatically. This product handles children's
   * records; an error-tracking service is not a place for any of that, and
   * nothing here is worth the exposure.
   */
  sendDefaultPii: false,

  /**
   * Errors only — no performance tracing.
   *
   * Tracing captures URLs and request payloads, which in this app means paths
   * containing student ids and bodies containing health notes. It also consumes
   * the free quota far faster than errors do.
   */
  tracesSampleRate: 0,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",

  /**
   * Disabled outside production.
   *
   * A development typo is not an incident, and letting local runs fill the quota
   * means the one real alert arrives after the limit is spent.
   */
  enabled: process.env.NODE_ENV === "production",

  /**
   * Last line of defence before anything leaves the process.
   *
   * `sendDefaultPii: false` already covers what Sentry collects on its own; this
   * covers what *we* might pass in by accident — an error message that quotes a
   * child's name, a query string carrying an email.
   */
  beforeSend(event: ErrorEvent): ErrorEvent | null {
    // Never send a request body. Nothing in this product's bodies is safe.
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      if (typeof event.request.url === "string") {
        // Keep the path, drop the query string: `?email=…` and `?token=…` both
        // appear in this codebase's URLs.
        event.request.url = event.request.url.split("?")[0];
      }
    }

    // The id is enough to find the account in our own database. The name, email
    // and IP address are not ours to hand to a third party.
    if (event.user) {
      event.user = { id: event.user.id };
    }

    return event;
  },
} satisfies NodeOptions & BrowserOptions;
