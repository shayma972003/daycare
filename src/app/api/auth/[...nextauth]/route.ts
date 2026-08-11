import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
  rateLimitResponse,
} from "@/lib/rate-limit";

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(request: Request): Promise<Response> {
  const response = await handler(request);
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

  return rateLimitResponse({
    status: "unavailable",
    remaining: 0,
    retryAfter: RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
  })!;
}
