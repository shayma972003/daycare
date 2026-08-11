import { prisma } from "@/lib/prisma";
import {
  rateLimit,
  resetRateLimit,
  clientIp,
  rateLimitResetResponse,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { issueTokenPair, claimsForSubject } from "@/lib/mobile-auth";
import { grants } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Sign-in for the mobile app — both kinds of account.
 *
 * Guardians used to come in through a separate phone-and-OTP path. The phone
 * only ever identified the account: the code itself went to the email on file,
 * because there is no SMS gateway. So the phone bought nothing and cost a
 * contradiction the nursery could see — a parent with an email and no phone
 * could not be invited at all.
 *
 * Now both kinds sign in with the email they were invited on and a password
 * they chose. The invitation is what proves the mailbox; see
 * src/lib/invitations.ts.
 *
 * `kind` is sent by the app because email alone cannot decide it: a teacher may
 * also be a parent at the same nursery, and then the address exists in both
 * tables. It selects which table to search — it grants nothing, and the claims
 * are built from the row that is actually found.
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
  /** Defaulted for older builds in the wild, which only ever sent staff. */
  kind: z.enum(["staff", "guardian"]).default("staff"),
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
  const kind = parsed.data.kind;
  // Keyed by kind as well, so a parent failing five times cannot lock out a
  // member of staff who happens to share the address.
  const lockKey = kind === "guardian" ? `login:guardian:${email}` : `login:${email}`;

  // The same key the web sign-in uses, so attempts across both clients share one
  // counter — otherwise the app would be a way to get five more guesses.
  const attempt = await rateLimit({ key: lockKey, limit: MAX_ATTEMPTS, windowMs: LOCKOUT_MS });
  const limitedResponse = rateLimitResponse(attempt);
  if (limitedResponse) return limitedResponse;

  if (kind === "guardian") {
    const account = await prisma.guardianAccount.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        disabledAt: true,
        acceptedAt: true,
        schoolId: true,
        guardian: { select: { name: true } },
        school: { select: { name: true } },
      },
    });

    // `passwordHash` is null between invitation and activation, so the dummy
    // keeps the timing flat for "invited but not yet activated" as well as for
    // "no such account" — those must not be distinguishable from outside.
    const ok = await bcrypt.compare(parsed.data.password, account?.passwordHash ?? DUMMY_HASH);

    if (!account || !ok || !account.acceptedAt) {
      return Response.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
    }
    if (account.disabledAt) {
      return Response.json({ error: "الحساب معطَّل" }, { status: 403 });
    }

    const resetResponse = rateLimitResetResponse(await resetRateLimit(lockKey));
    if (resetResponse) return resetResponse;

    // Re-read through the shared helper rather than trusting the row above: it
    // is what also checks the school's subscription, and one definition of "may
    // this account have a token" is the point of it existing.
    const guardianClaims = await claimsForSubject("guardian", account.id);
    if (!guardianClaims) {
      return Response.json({ error: "الحساب أو الاشتراك غير فعّال" }, { status: 403 });
    }

    const guardianPair = await issueTokenPair(guardianClaims, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: clientIp(request),
    });

    await prisma.guardianAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });

    return Response.json({
      ...guardianPair,
      account: {
        id: account.id,
        kind: "guardian",
        name: account.guardian?.name ?? "",
        schoolId: account.schoolId,
        schoolName: account.school?.name ?? "",
        // A parent holds no permission keys. Sent as an empty list rather than
        // omitted so the app has one shape to read.
        permissions: [],
      },
    });
  }

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

  const resetResponse = rateLimitResetResponse(await resetRateLimit(lockKey));
  if (resetResponse) return resetResponse;

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
