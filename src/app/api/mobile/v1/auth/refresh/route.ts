import { rotateRefreshToken, revokeRefreshToken } from "@/lib/mobile-auth";
import { clientIp } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({ refreshToken: z.string().min(20) });

/**
 * Exchanges a refresh token for a new pair.
 *
 * Every failure returns 401 with a distinct `code`. The app needs to tell them
 * apart: an expired token means "sign in again", while `TOKEN_REUSED` means the
 * session was revoked because a copy of the token was seen in circulation, and
 * that is worth telling the user about rather than silently bouncing them to the
 * login screen.
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
    return Response.json({ error: "التوكن مفقود" }, { status: 422 });
  }

  const result = await rotateRefreshToken(parsed.data.refreshToken, {
    userAgent: request.headers.get("user-agent"),
    ipAddress: clientIp(request),
  });

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      invalid: "جلسة غير معروفة",
      expired: "انتهت صلاحية الجلسة",
      revoked: "تم إنهاء الجلسة",
      reused: "تم إنهاء الجلسة لأسباب أمنية — يرجى تسجيل الدخول مجدداً",
    };
    return Response.json(
      { error: messages[result.reason], code: result.reason.toUpperCase() },
      { status: 401 }
    );
  }

  return Response.json({
    ...result.pair,
    account: { id: result.claims.sub, kind: result.claims.kind, schoolId: result.claims.schoolId },
  });
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
