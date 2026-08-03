import { prisma } from "@/lib/prisma";
import { rateLimit, resetRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { issueTokenPair, claimsForSubject } from "@/lib/mobile-auth";
import { grants } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Staff sign-in for the mobile app.
 *
 * Email and password rather than the guardians' phone-and-OTP: staff already
 * have credentials for the web dashboard and expect to use the same ones. This
 * is the same account, reached through a different door.
 *
 * The 2FA branch of the web sign-in is deliberately not reproduced here. It
 * ends by throwing a `2FA_REQUIRED:` string that only the NextAuth sign-in page
 * knows how to interpret, and a half-implemented second factor is worse than a
 * clearly absent one — a school with 2FA enabled is refused with an explanation
 * instead of being silently let in without it.
 */

/** Matches the web sign-in, so lockout behaviour does not differ by client. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** Timing-flat comparison when no user matches — see the note in src/lib/auth.ts. */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.iVMhrpZ9zXBcVBrEXvXJZgFqbrJmZ7q";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const lockKey = `login:${email}`;

  // The same key the web sign-in uses, so attempts across both clients share one
  // counter — otherwise the app would be a way to get five more guesses.
  const attempt = await rateLimit({ key: lockKey, limit: MAX_ATTEMPTS, windowMs: LOCKOUT_MS });
  if (!attempt.ok) return tooManyRequests(attempt.retryAfter);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      password: true,
      name: true,
      schoolId: true,
      disabledAt: true,
      roleRef: { select: { permissions: true } },
      school: { select: { name: true, twoFaEnabled: true } },
    },
  });

  const valid = await bcrypt.compare(parsed.data.password, user?.password ?? DUMMY_HASH);

  if (!user || !valid) {
    return Response.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
  }

  await resetRateLimit(lockKey);

  if (user.disabledAt) {
    return Response.json({ error: "الحساب معطَّل" }, { status: 403 });
  }

  if (user.school?.twoFaEnabled) {
    return Response.json(
      {
        error: "التحقق بخطوتين غير مدعوم في التطبيق بعد — استخدم الموقع لتسجيل الدخول",
        code: "2FA_NOT_SUPPORTED",
      },
      { status: 409 }
    );
  }

  // A role that cannot sign in to the app is not a partial permission — it is a
  // decision the school made, and it is enforced here rather than by hiding the
  // button.
  const permissions = user.roleRef?.permissions ?? [];
  if (!grants(permissions, "auth.app")) {
    return Response.json(
      { error: "هذا الحساب غير مصرّح له بالدخول إلى التطبيق", code: "APP_ACCESS_DENIED" },
      { status: 403 }
    );
  }

  const claims = await claimsForSubject("staff", user.id);
  if (!claims) {
    return Response.json({ error: "الحساب أو الاشتراك غير فعّال" }, { status: 403 });
  }

  const pair = await issueTokenPair(claims, {
    userAgent: request.headers.get("user-agent"),
    ipAddress: clientIp(request),
  });

  return Response.json({
    ...pair,
    account: {
      id: user.id,
      kind: "staff",
      name: user.name,
      schoolId: user.schoolId,
      schoolName: user.school?.name ?? "",
      permissions,
    },
  });
}
