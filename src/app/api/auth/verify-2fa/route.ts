import { prisma } from "@/lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
  otp_code: z.string().min(1),
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
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const { twoFaSessionId, otp_code } = parsed.data;

  // Backs up the per-session attempt counter: without it a host could open many
  // sessions and get 5 fresh guesses on each.
  const limited = await rateLimit({
    key: `verify2fa:ip:${clientIp(request)}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const session = await prisma.twoFASession.findUnique({ where: { id: twoFaSessionId } });

  if (
    !session ||
    session.purpose !== "LOGIN" ||
    session.verified ||
    session.expiresAt < new Date() ||
    session.attempts >= 5
  ) {
    return Response.json({ error: "انتهت صلاحية رمز التحقق، الرجاء إعادة الإرسال" }, { status: 400 });
  }

  const isValid = await bcrypt.compare(otp_code, session.otpCodeHash);
  if (!isValid) {
    await prisma.twoFASession.update({
      where: { id: session.id },
      data: { attempts: { increment: 1 } },
    });
    return Response.json({ error: "رمز التحقق غير صحيح" }, { status: 400 });
  }

  const rawToken = randomBytes(32).toString("hex");
  const bypassTokenHash = createHash("sha256").update(rawToken).digest("hex");

  await prisma.twoFASession.update({
    where: { id: session.id },
    data: {
      verified: true,
      bypassTokenHash,
      bypassExpires: new Date(Date.now() + 30 * 1000),
    },
  });

  return Response.json({ success: true, bypassToken: rawToken });
}
