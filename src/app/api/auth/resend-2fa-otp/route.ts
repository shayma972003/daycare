import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

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
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const limited = await rateLimit({
    key: `resend2fa:ip:${clientIp(request)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const session = await prisma.twoFASession.findUnique({
    where: { id: parsed.data.twoFaSessionId },
    include: { school: { select: { name: true } } },
  });

  if (!session || session.verified || session.expiresAt < new Date()) {
    return Response.json({ error: "الجلسة غير صالحة" }, { status: 404 });
  }

  // Throttle is measured on this row's own last send. Previously it compared
  // against the *old* session while creating a *new* one, so replaying the
  // original id passed the check forever.
  if (Date.now() - session.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    return Response.json({ error: "الرجاء الانتظار قبل إعادة الإرسال" }, { status: 429 });
  }

  if (session.resendCount >= MAX_RESENDS) {
    return Response.json(
      { error: "تم تجاوز عدد مرات إعادة الإرسال. سجّل الدخول من جديد." },
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
    return Response.json({ error: "تعذر إرسال الرمز" }, { status: 400 });
  }

  const otp = generateOTP();
  const otpCodeHash = await bcrypt.hash(otp, 10);

  // Rotate in place: `attempts` carries over, so the 5-attempt lockout holds.
  await prisma.twoFASession.update({
    where: { id: session.id },
    data: {
      otpCodeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      lastSentAt: new Date(),
      resendCount: { increment: 1 },
    },
  });

  await sendEmail(
    recipient,
    "رمز التحقق بخطوتين",
    `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
    session.school.name
  );

  return Response.json({ success: true, twoFaSessionId: session.id });
}
