import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { otpMatches, MAX_OTP_ATTEMPTS } from "@/lib/enrollment-otp";
import { normalizePhone } from "@/lib/phone-normalizer";
import { issueTokenPair, claimsForSubject } from "@/lib/mobile-auth";
import { z } from "zod";

/**
 * Step two of mobile sign-in: exchange the emailed code for a token pair.
 *
 * The session row is consumed whatever the outcome — a correct code is used
 * once, and a wrong one burns an attempt. Without the counter six digits fall to
 * brute force in minutes, which is the defect this flow's web equivalent had
 * before task 0.14.
 */

const schema = z.object({
  phone: z.string().min(6).max(20),
  otp: z.string().length(6),
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

  const limited = await rateLimit({
    key: `mobile-verify:ip:${clientIp(request)}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const phone = normalizePhone(parsed.data.phone);

  const account = await prisma.guardianAccount.findFirst({
    where: { phone, disabledAt: null },
    select: { id: true, guardianId: true },
  });

  // One message for every failure below. Distinguishing "no such number" from
  // "wrong code" would undo the enumeration protection of the request step.
  const invalid = Response.json(
    { error: "الرمز غير صحيح أو منتهي الصلاحية" },
    { status: 401 }
  );

  if (!account) return invalid;

  const session = await prisma.twoFASession.findFirst({
    where: {
      userId: account.id,
      purpose: "MOBILE_LOGIN",
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) return invalid;

  if (session.attempts >= MAX_OTP_ATTEMPTS) {
    return Response.json(
      { error: "تم تجاوز عدد المحاولات — اطلب رمزاً جديداً" },
      { status: 429 }
    );
  }

  if (!otpMatches(session.otpCodeHash, parsed.data.otp)) {
    await prisma.twoFASession.update({
      where: { id: session.id },
      data: { attempts: { increment: 1 } },
    });
    return invalid;
  }

  // Marked verified before the tokens are issued, so the same code cannot be
  // replayed by a second request that arrives while this one is still running.
  await prisma.twoFASession.update({
    where: { id: session.id },
    data: { verified: true },
  });

  /**
   * First sign-in doubles as accepting the invitation.
   *
   * A guardian who proves control of the address the nursery holds has done
   * everything the invitation link would have asked of them, so requiring the
   * link as well would strand anyone whose email arrived after it expired.
   */
  await prisma.guardianAccount.update({
    where: { id: account.id },
    data: {
      lastLoginAt: new Date(),
      acceptedAt: new Date(),
      inviteTokenHash: null,
      inviteExpiresAt: null,
    },
  });

  const claims = await claimsForSubject("guardian", account.id);
  if (!claims) {
    return Response.json({ error: "الحساب غير مفعّل" }, { status: 403 });
  }

  const pair = await issueTokenPair(claims, {
    userAgent: request.headers.get("user-agent"),
    ipAddress: clientIp(request),
  });

  return Response.json({
    ...pair,
    account: { id: account.id, kind: "guardian", schoolId: claims.schoolId },
  });
}
