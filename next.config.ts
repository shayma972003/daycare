import type { NextConfig } from "next";

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
};

export default nextConfig;
