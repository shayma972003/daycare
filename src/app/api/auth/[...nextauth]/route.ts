import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
  rateLimitResponse,
} from "@/lib/rate-limit";

const handler = NextAuth(authOptions);

type NextAuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

function preventAuthCaching(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(
  request: NextRequest,
  context: NextAuthRouteContext
): Promise<Response> {
  return preventAuthCaching(await handler(request, context));
}

export async function POST(
  request: NextRequest,
  context: NextAuthRouteContext
): Promise<Response> {
  // next-auth v4 selects its App Router adapter from this second argument.
  // Omitting it makes the library treat the Web Request like a Pages API
  // request and read `req.query`, which does not exist in a Route Handler.
  const response = preventAuthCaching(await handler(request, context));
  if (response.status !== 401) return response;

  // NextAuth maps every CredentialsProvider error to 401. Preserve that for
  // invalid credentials and lockouts, but surface limiter-store outages as the
  // required 503 so clients do not mistake an infrastructure failure for a
  // user failure. Inspect a clone so the original response remains readable.
  const location = response.headers.get("location") ?? "";
  const body = await response.clone().text();
  if (!location.includes("RATE_LIMIT_UNAVAILABLE") && !body.includes("RATE_LIMIT_UNAVAILABLE")) {
    return response;
  }

  return preventAuthCaching(
    rateLimitResponse({
      status: "unavailable",
      remaining: 0,
      retryAfter: RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
    })!
  );
}
