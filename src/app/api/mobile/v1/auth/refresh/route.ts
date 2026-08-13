import { rotateRefreshToken, revokeRefreshToken } from "@/lib/mobile-auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitSubject } from "@/lib/one-time-code";
import { withNoStore } from "@/lib/auth-response";
import { z } from "zod";

const schema = z.object({ refreshToken: z.string().min(20) });

/**
 * Exchanges a refresh token for a new pair.
 *
 * Every authentication failure is deliberately indistinguishable to the
 * caller. The server logs the internal reason without logging the bearer token
 * or its full hash.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return withNoStore(Response.json({ error: "التوكن مفقود" }, { status: 422 }));
  }

  const limitedResponse = rateLimitResponse(
    await rateLimit({
      key: `mobile:refresh:${rateLimitSubject(parsed.data.refreshToken)}:${rateLimitSubject(clientIp(request))}`,
      limit: 20,
      windowMs: 15 * 60 * 1000,
    })
  );
  if (limitedResponse) return withNoStore(limitedResponse);

  const result = await rotateRefreshToken(parsed.data.refreshToken, {
    userAgent: request.headers.get("user-agent"),
    ipAddress: clientIp(request),
  });

  if (!result.ok) {
    return withNoStore(Response.json(
      { error: "تعذّر تجديد الجلسة، يرجى تسجيل الدخول مجدداً", code: "SESSION_INVALID" },
      { status: 401 }
    ));
  }

  return withNoStore(Response.json({
    ...result.pair,
    account: { id: result.claims.sub, kind: result.claims.kind, schoolId: result.claims.schoolId },
  }));
}

/** Sign-out. On a shared phone this has to actually end the session. */
export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "التوكن مفقود" }, { status: 422 });
  }

  await revokeRefreshToken(parsed.data.refreshToken);
  return Response.json({ success: true });
}
