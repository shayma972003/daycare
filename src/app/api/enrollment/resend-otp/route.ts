import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import {
  generateOtp,
  hashOtp,
  buildOtpMessage,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  MAX_OTP_RESENDS,
} from "@/lib/enrollment-otp";
import { rateLimitSubject } from "@/lib/one-time-code";
import { authJson, withNoStore } from "@/lib/auth-response";

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return authJson({ error: "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط­ظٹط­ط©" }, { status: 422 });

  const { token } = parsed.data;

  const limited = await rateLimit({
    key: `enroll:resend:${rateLimitSubject(clientIp(request))}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return withNoStore(limitedResponse);

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true, email: true } } },
  });

  if (!rec) return authJson({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return authJson({ error: "expired" }, { status: 410 });
  if (rec.otp_verified) {
    return authJson({ error: "طھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط±ط§ط¨ط· ط¨ط§ظ„ظپط¹ظ„" }, { status: 409 });
  }
  if (!rec.sent_to_email) {
    return authJson({ error: "ظ„ط§ ظٹظˆط¬ط¯ ط¨ط±ظٹط¯ ظ…ط³ط¬ظ‘ظ„ ظ„ظ‡ط°ط§ ط§ظ„ط±ط§ط¨ط·" }, { status: 400 });
  }

  // Previously this endpoint had no throttle and no cap: replaying it kept
  // refreshing otp_expires_at, so the window never closed and each call sent
  // another message at the platform's cost.
  if (
    rec.otp_last_sent_at &&
    Date.now() - rec.otp_last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return authJson({ error: "ط§ظ„ط±ط¬ط§ط، ط§ظ„ط§ظ†طھط¸ط§ط± ظ‚ط¨ظ„ ط¥ط¹ط§ط¯ط© ط§ظ„ط¥ط±ط³ط§ظ„" }, { status: 429 });
  }

  if (rec.otp_resend_count >= MAX_OTP_RESENDS) {
    return authJson(
      { error: "طھظ… طھط¬ط§ظˆط² ط¹ط¯ط¯ ظ…ط±ط§طھ ط¥ط¹ط§ط¯ط© ط§ظ„ط¥ط±ط³ط§ظ„. طھظˆط§طµظ„ ظ…ط¹ ط§ظ„ط­ط¶ط§ظ†ط©." },
      { status: 429 }
    );
  }

  const otp = generateOtp();
  const now = new Date();

  const rotated = await prisma.enrollmentToken.updateMany({
    where: {
      id: rec.id,
      token,
      otp_verified: false,
      otp_code_hash: rec.otp_code_hash,
      otp_last_sent_at: rec.otp_last_sent_at,
      otp_resend_count: { lt: MAX_OTP_RESENDS },
    },
    data: {
      otp_code_hash: hashOtp(otp),
      otp_expires_at: new Date(now.getTime() + OTP_TTL_MS),
      otp_last_sent_at: now,
      otp_resend_count: { increment: 1 },
      // Attempts deliberately carry over â€” resetting them here would hand an
      // attacker unlimited guesses by alternating verify and resend.
    },
  });
  if (rotated.count !== 1) {
    return authJson({ error: "invalid" }, { status: 409 });
  }

  const delivery = await sendEmail(
    rec.sent_to_email,
    `ط±ظ…ط² طھط­ظ‚ظ‚ ط¬ط¯ظٹط¯ â€” ${rec.school.name}`,
    buildOtpMessage(rec.school.name, otp, `${env.APP_URL}/enroll/${token}`),
    rec.school.name,
    {
      sender: {
        kind: "school",
        displayName: rec.school.name,
        replyTo: rec.school.email,
      },
      language: "ar",
    }
  );

  if (!delivery.success) {
    await prisma.enrollmentToken.update({
      where: { token },
      data: { otp_expires_at: new Date(0) },
    });
    console.error("[enrollment-otp] failed to deliver code", rec.school_id);
    return authJson(
      { error: "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚ ط¹ط¨ط± ط§ظ„ط¨ط±ظٹط¯. ط­ط§ظˆظ„ ظ…ط¬ط¯ط¯ط§ظ‹." },
      { status: 502 }
    );
  }

  return authJson({ success: true });
}
