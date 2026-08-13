import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { randomInt } from "crypto";
import { hashOneTimeCode } from "@/lib/one-time-code";
import { authJson, withNoStore } from "@/lib/auth-response";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

export async function POST() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return withNoStore(
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const limitedResponse = rateLimitResponse(
    await rateLimit({ key: `2fa:send:${schoolId}:${session.user.id}`, limit: 5, windowMs: 15 * 60 * 1000 })
  );
  if (limitedResponse) {
    limitedResponse.headers.set("Cache-Control", "no-store");
    return limitedResponse;
  }
  const email = session.user.email;
  if (!email) {
    return authJson(
      { error: "يجب إضافة بريد إلكتروني إلى حسابك أولاً" },
      { status: 400 }
    );
  }

  const lastSession = await prisma.twoFASession.findFirst({
    where: { schoolId, purpose: "ACTIVATE" },
    orderBy: { createdAt: "desc" },
  });
  if (lastSession && Date.now() - lastSession.createdAt.getTime() < 60 * 1000) {
    return authJson({ error: "الرجاء الانتظار قبل إعادة الإرسال" }, { status: 429 });
  }

  const otp = generateOTP();
  const otpCodeHash = hashOneTimeCode(otp, "2fa-activate");

  const twoFaSession = await prisma.twoFASession.create({
    data: {
      schoolId,
      userId: session.user.id,
      purpose: "ACTIVATE",
      otpCodeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const delivery = await sendEmail(
    email,
    "رمز تفعيل التحقق بخطوتين",
    `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
    session.user.schoolName
  );

  if (!delivery.success) {
    await prisma.twoFASession.deleteMany({
      where: { id: twoFaSession.id, schoolId, purpose: "ACTIVATE" },
    });
    console.error("[2fa-activation] failed to deliver activation code", schoolId);
    return authJson(
      { error: "تعذر إرسال رمز التحقق عبر البريد. حاول مجدداً." },
      { status: 502 }
    );
  }

  return authJson({ twoFaSessionId: twoFaSession.id });
}
