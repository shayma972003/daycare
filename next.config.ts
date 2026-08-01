import type { NextConfig } from "next";

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
      // Uploads are stored as data: URIs, so images must allow that scheme.
      "img-src 'self' data: blob:",
      "connect-src 'self'",
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

export default nextConfig;
