import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createHash } from "crypto";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { otpMatches, MAX_OTP_ATTEMPTS } from "@/lib/enrollment-otp";

const schema = z.object({
  token: z.string().min(1),
  otp_code: z.string().length(6),
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

  const { token, otp_code } = parsed.data;

  // Second line of defence behind the per-token counter: without it an attacker
  // could request many tokens and get a fresh allowance of guesses on each.
  const limited = await rateLimit({
    key: `enroll:verify:${clientIp(request)}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true, logoUrl: true } } },
  });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });

  if (rec.otp_verified) {
    return Response.json({
      success: true,
      school: { name: rec.school.name, logoUrl: rec.school.logoUrl },
    });
  }

  if (rec.otp_attempts >= MAX_OTP_ATTEMPTS) {
    return Response.json(
      { error: "تم تجاوز عدد المحاولات. اطلب رمزاً جديداً." },
      { status: 429 }
    );
  }

  if (!rec.otp_expires_at || rec.otp_expires_at < new Date()) {
    return Response.json({ error: "انتهت صلاحية الرمز. اطلب رمزاً جديداً." }, { status: 410 });
  }

  if (!otpMatches(rec.otp_code_hash, otp_code)) {
    const updated = await prisma.enrollmentToken.update({
      where: { token },
      data: { otp_attempts: { increment: 1 } },
      select: { otp_attempts: true },
    });

    const left = Math.max(0, MAX_OTP_ATTEMPTS - updated.otp_attempts);
    return Response.json(
      {
        error: left > 0
          ? `رمز التحقق غير صحيح. المحاولات المتبقية: ${left}`
          : "تم تجاوز عدد المحاولات. اطلب رمزاً جديداً.",
      },
      { status: 401 }
    );
  }

  const ua = request.headers.get("user-agent") ?? "";
  const ip = clientIp(request);
  const fingerprint = createHash("sha256").update(`${ua}|${ip}`).digest("hex").slice(0, 16);

  await prisma.enrollmentToken.update({
    where: { token },
    data: {
      otp_verified: true,
      status: "active",
      device_fingerprint: fingerprint,
      // Burn the code: it has done its job and must not be replayable.
      otp_code_hash: null,
      otp_attempts: 0,
    },
  });

  return Response.json({
    success: true,
    school: { name: rec.school.name, logoUrl: rec.school.logoUrl },
  });
}
