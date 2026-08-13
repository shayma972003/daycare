import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { authJson, withNoStore } from "@/lib/auth-response";
import { oneTimeCodeMatches, rateLimitSubject } from "@/lib/one-time-code";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
  otp_code: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return authJson({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const { twoFaSessionId, otp_code } = parsed.data;

  // Backs up the per-session attempt counter: without it a host could open many
  // sessions and get 5 fresh guesses on each.
  const limited = await rateLimit({
    key: `verify2fa:ip:${rateLimitSubject(clientIp(request))}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return withNoStore(limitedResponse);

  const session = await prisma.twoFASession.findUnique({ where: { id: twoFaSessionId } });

  if (
    !session ||
    session.purpose !== "LOGIN" ||
    session.verified ||
    session.expiresAt < new Date() ||
    session.attempts >= 5
  ) {
    return authJson({ error: "انتهت صلاحية رمز التحقق، الرجاء إعادة الإرسال" }, { status: 400 });
  }

  const now = new Date();
  const isValid = await oneTimeCodeMatches(session.otpCodeHash, otp_code, "2fa-login", now);
  if (!isValid) {
    await prisma.twoFASession.updateMany({
      where: {
        id: session.id,
        verified: false,
        expiresAt: { gt: now },
        attempts: { lt: 5 },
        otpCodeHash: session.otpCodeHash,
      },
      data: { attempts: { increment: 1 } },
    });
    return authJson({ error: "رمز التحقق غير صحيح" }, { status: 400 });
  }

  const rawToken = randomBytes(32).toString("hex");
  const bypassTokenHash = createHash("sha256").update(rawToken).digest("hex");

  const claimed = await prisma.twoFASession.updateMany({
    where: {
      id: session.id,
      purpose: "LOGIN",
      verified: false,
      expiresAt: { gt: now },
      attempts: { lt: 5 },
      otpCodeHash: session.otpCodeHash,
    },
    data: {
      verified: true,
      bypassTokenHash,
      bypassExpires: new Date(Date.now() + 30 * 1000),
    },
  });

  if (claimed.count !== 1) {
    return authJson({ error: "انتهت صلاحية رمز التحقق، الرجاء إعادة الإرسال" }, { status: 400 });
  }

  return authJson({ success: true, bypassToken: rawToken });
}
