import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import {
  generateOtp,
  hashOtp,
  buildOtpMessage,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  MAX_OTP_RESENDS,
} from "@/lib/enrollment-otp";

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });

  const { token } = parsed.data;

  const limited = await rateLimit({
    key: `enroll:resend:${clientIp(request)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true } } },
  });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });
  if (rec.otp_verified) {
    return Response.json({ error: "تم التحقق من هذا الرابط بالفعل" }, { status: 409 });
  }
  if (!rec.sent_to_email) {
    return Response.json({ error: "لا يوجد بريد مسجّل لهذا الرابط" }, { status: 400 });
  }

  // Previously this endpoint had no throttle and no cap: replaying it kept
  // refreshing otp_expires_at, so the window never closed and each call sent
  // another message at the platform's cost.
  if (
    rec.otp_last_sent_at &&
    Date.now() - rec.otp_last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return Response.json({ error: "الرجاء الانتظار قبل إعادة الإرسال" }, { status: 429 });
  }

  if (rec.otp_resend_count >= MAX_OTP_RESENDS) {
    return Response.json(
      { error: "تم تجاوز عدد مرات إعادة الإرسال. تواصل مع الحضانة." },
      { status: 429 }
    );
  }

  const otp = generateOtp();
  const now = new Date();

  await prisma.enrollmentToken.update({
    where: { token },
    data: {
      otp_code_hash: hashOtp(otp),
      otp_expires_at: new Date(now.getTime() + OTP_TTL_MS),
      otp_last_sent_at: now,
      otp_resend_count: { increment: 1 },
      // Attempts deliberately carry over — resetting them here would hand an
      // attacker unlimited guesses by alternating verify and resend.
    },
  });

  await sendEmail(
    rec.sent_to_email,
    `رمز تحقق جديد — ${rec.school.name}`,
    buildOtpMessage(rec.school.name, otp, `${env.APP_URL}/enroll/${token}`),
    rec.school.name
  );

  return Response.json({ success: true });
}
