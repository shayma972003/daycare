import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Security headers.
 *
 * None were set previously, on an app holding children's identities, health
 * notes and financial records. These are the defaults every such deployment
 * should carry.
 */
const securityHeaders = [
  // Stops the browser guessing a response is a script when it is not.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Framing is the vector for clickjacking a logged-in dashboard.
  { key: "X-Frame-Options", value: "DENY" },
  // Never leak a full dashboard URL (which contains ids) to a third-party site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app needs none of these; denying them shrinks the attack surface.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts and, in dev, uses eval for HMR.
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind and the Google Fonts stylesheet both need inline styles.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      // `data:` covers uploads not yet migrated off base64 columns. The R2 host
      // is needed because `/api/files/…` answers with a 302 to a signed URL, and
      // a redirect that crosses origins is re-checked against this list.
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
      // The browser SDK posts errors to the Sentry ingest host. Without this
      // the CSP blocks every report and the console fills with violations —
      // a silently broken integration that looks configured.
      // Deliberately *not* listing the R2 host. Nothing fetches an object with
      // XHR — images use `<img>`, which CSP governs through `img-src`, and a
      // document is opened as a navigation. A bucket with no CORS policy would
      // refuse a cross-origin `fetch` regardless, so allowing it here would only
      // suggest a path that does not work.
      "connect-src 'self' https://*.ingest.de.sentry.io",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    // Disable the client-side Router Cache for dynamic pages so navigating
    // back to a page after making a change always reflects the latest data,
    // instead of showing a stale snapshot until a manual refresh.
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },

  // Leaking the framework version in a response header helps nobody but a scanner.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          // HSTS is meaningless over http and harmful to pin in development.
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

/**
 * Sentry build integration.
 *
 * Two things this adds beyond the runtime SDK: it uploads source maps so a
 * browser stack trace reads as our code rather than minified output, and it
 * tunnels reports through our own origin so ad blockers do not silently swallow
 * them.
 *
 * Source-map upload needs `SENTRY_AUTH_TOKEN`, which is not set yet — so it is
 * conditional. A missing token must not break the build; it only means traces
 * stay minified until the token is added.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Quiet unless something is wrong; the build log is long enough already.
  silent: !process.env.CI,

  // Skipped entirely without a token, rather than failing the build.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  /**
   * Routes reports through `/monitoring` on our own domain.
   *
   * Ad blockers block requests to `sentry.io` by name, which means the errors
   * you most want — the ones from a real user's browser — are the ones least
   * likely to arrive.
   */
  tunnelRoute: "/monitoring",
});
