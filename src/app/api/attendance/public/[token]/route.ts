import { getAttendancePageData } from "@/lib/attendance-data";
import { resolveAttendanceToken } from "@/lib/attendance-token";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

/**
 * Kiosk roster feed. Unauthenticated by design — a wall-mounted tablet has no
 * session — but gated by an opaque, rotatable token instead of the school id,
 * which was public knowledge and could never be revoked.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Per-IP throttle so a leaked token still cannot be used to scrape the roster
  // in bulk, and so unknown tokens cannot be brute-forced.
  const limited = await rateLimit({
    key: `kiosk:read:${clientIp(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const school = await resolveAttendanceToken(token);
  if (!school) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data = await getAttendancePageData(school.id);
  return Response.json({ school, ...data });
}
