import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import { randomInt } from "crypto";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { hashOneTimeCode, rateLimitSubject } from "@/lib/one-time-code";
import { authJson, withNoStore } from "@/lib/auth-response";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
});

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESENDS = 3;
const OTP_TTL_MS = 10 * 60 * 1000;

function generateOTP(): string {
  return String(randomInt(100000, 1000000));
}
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return authJson({ error: "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط­ظٹط­ط©" }, { status: 400 });
  }

  const limited = await rateLimit({
    key: `resend2fa:ip:${rateLimitSubject(clientIp(request))}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return withNoStore(limitedResponse);

  const session = await prisma.twoFASession.findUnique({
    where: { id: parsed.data.twoFaSessionId },
    include: { school: { select: { name: true } } },
  });

  if (!session || session.verified || session.expiresAt < new Date()) {
    return authJson({ error: "ط§ظ„ط¬ظ„ط³ط© ط؛ظٹط± طµط§ظ„ط­ط©" }, { status: 404 });
  }

  // Throttle is measured on this row's own last send. Previously it compared
  // against the *old* session while creating a *new* one, so replaying the
  // original id passed the check forever.
  if (Date.now() - session.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    return authJson({ error: "ط§ظ„ط±ط¬ط§ط، ط§ظ„ط§ظ†طھط¸ط§ط± ظ‚ط¨ظ„ ط¥ط¹ط§ط¯ط© ط§ظ„ط¥ط±ط³ط§ظ„" }, { status: 429 });
  }

  if (session.resendCount >= MAX_RESENDS) {
    return authJson(
      { error: "طھظ… طھط¬ط§ظˆط² ط¹ط¯ط¯ ظ…ط±ط§طھ ط¥ط¹ط§ط¯ط© ط§ظ„ط¥ط±ط³ط§ظ„. ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯." },
      { status: 429 }
    );
  }

  // Resolve the destination from the session's own owner, never from the request.
  let recipient: string | null = null;

  if (session.userId) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true },
    });
    recipient = user?.email ?? null;
  } else {
    const owner = await prisma.user.findFirst({
      where: { schoolId: session.schoolId },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    recipient = owner?.email ?? null;
  }

  if (!recipient) {
    return authJson({ error: "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط±ظ…ط²" }, { status: 400 });
  }

  const otp = generateOTP();
  const otpCodeHash = hashOneTimeCode(
    otp,
    session.purpose === "ACTIVATE" ? "2fa-activate" : "2fa-login"
  );

  // Rotate in place: `attempts` carries over, so the 5-attempt lockout holds.
  const rotated = await prisma.twoFASession.updateMany({
    where: {
      id: session.id,
      verified: false,
      otpCodeHash: session.otpCodeHash,
      lastSentAt: session.lastSentAt,
      resendCount: { lt: MAX_RESENDS },
    },
    data: {
      otpCodeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      lastSentAt: new Date(),
      resendCount: { increment: 1 },
    },
  });
  if (rotated.count !== 1) {
    return authJson({ error: "ط§ظ„ط¬ظ„ط³ط© ط؛ظٹط± طµط§ظ„ط­ط©" }, { status: 409 });
  }

  const delivery = await sendEmail(
    recipient,
    "ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚ ط¨ط®ط·ظˆطھظٹظ†",
    `ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚ ط¨ط®ط·ظˆطھظٹظ†: ${otp}\nطµط§ظ„ط­ ظ„ظ…ط¯ط© 10 ط¯ظ‚ط§ط¦ظ‚. ظ„ط§ طھط´ط§ط±ظƒظ‡ ظ…ط¹ ط£ط­ط¯.`,
    session.school.name
  );

  if (!delivery.success) {
    await prisma.twoFASession.deleteMany({ where: { id: session.id } });
    console.error("[2fa-resend] failed to deliver code", session.schoolId);
    return authJson(
      { error: "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚ ط¹ط¨ط± ط§ظ„ط¨ط±ظٹط¯. ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯." },
      { status: 502 }
    );
  }

  return authJson({ success: true, twoFaSessionId: session.id });
}
