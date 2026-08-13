import { prisma } from "@/lib/prisma";
import { stampFileUrl } from "@/lib/file-token";
import { z } from "zod";
import { createHash } from "crypto";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { otpMatches, MAX_OTP_ATTEMPTS } from "@/lib/enrollment-otp";
import { rateLimitSubject } from "@/lib/one-time-code";
import { authJson, withNoStore } from "@/lib/auth-response";

const schema = z.object({
  token: z.string().min(1),
  otp_code: z.string().length(6),
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
    return authJson({ error: "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط­ظٹط­ط©" }, { status: 422 });
  }

  const { token, otp_code } = parsed.data;

  // Second line of defence behind the per-token counter: without it an attacker
  // could request many tokens and get a fresh allowance of guesses on each.
  const limited = await rateLimit({
    key: `enroll:verify:${rateLimitSubject(clientIp(request))}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return withNoStore(limitedResponse);

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true, logoUrl: true } } },
  });

  if (!rec) return authJson({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return authJson({ error: "expired" }, { status: 410 });

  if (rec.otp_verified) {
    return authJson({ error: "used" }, { status: 409 });
  }

  if (rec.otp_attempts >= MAX_OTP_ATTEMPTS) {
    return authJson(
      { error: "طھظ… طھط¬ط§ظˆط² ط¹ط¯ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ. ط§ط·ظ„ط¨ ط±ظ…ط²ط§ظ‹ ط¬ط¯ظٹط¯ط§ظ‹." },
      { status: 429 }
    );
  }

  if (!rec.otp_expires_at || rec.otp_expires_at < new Date()) {
    return authJson({ error: "ط§ظ†طھظ‡طھ طµظ„ط§ط­ظٹط© ط§ظ„ط±ظ…ط². ط§ط·ظ„ط¨ ط±ظ…ط²ط§ظ‹ ط¬ط¯ظٹط¯ط§ظ‹." }, { status: 410 });
  }

  if (!(await otpMatches(rec.otp_code_hash, otp_code))) {
    const updated = await prisma.enrollmentToken.updateMany({
      where: {
        id: rec.id,
        token,
        otp_verified: false,
        otp_attempts: { lt: MAX_OTP_ATTEMPTS },
        otp_expires_at: { gt: new Date() },
        otp_code_hash: rec.otp_code_hash,
      },
      data: { otp_attempts: { increment: 1 } },
    });

    const left = Math.max(0, MAX_OTP_ATTEMPTS - rec.otp_attempts - updated.count);
    return authJson(
      {
        error: left > 0
          ? `ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚ ط؛ظٹط± طµط­ظٹط­. ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ظ…طھط¨ظ‚ظٹط©: ${left}`
          : "طھظ… طھط¬ط§ظˆط² ط¹ط¯ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ. ط§ط·ظ„ط¨ ط±ظ…ط²ط§ظ‹ ط¬ط¯ظٹط¯ط§ظ‹.",
      },
      { status: 401 }
    );
  }

  const ua = request.headers.get("user-agent") ?? "";
  const ip = clientIp(request);
  const fingerprint = createHash("sha256").update(`${ua}|${ip}`).digest("hex").slice(0, 16);

  const claimed = await prisma.enrollmentToken.updateMany({
    where: {
      id: rec.id,
      token,
      otp_verified: false,
      otp_attempts: { lt: MAX_OTP_ATTEMPTS },
      otp_expires_at: { gt: new Date() },
      otp_code_hash: rec.otp_code_hash,
    },
    data: {
      otp_verified: true,
      status: "active",
      device_fingerprint: fingerprint,
      // Burn the code: it has done its job and must not be replayable.
      otp_code_hash: null,
      otp_attempts: 0,
    },
  });
  if (claimed.count !== 1) {
    return authJson({ error: "invalid" }, { status: 409 });
  }

  return authJson({
    success: true,
    school: { name: rec.school.name, logoUrl: stampFileUrl(rec.school.logoUrl) },
  });
}
