import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال"),
  otp: z.string().length(6, "رمز التحقق يجب أن يكون 6 أرقام"),
  newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

/** After this many wrong guesses the token is burned and a new one must be requested. */
const MAX_ATTEMPTS = 5;

const GENERIC_ERROR = "رمز التحقق غير صحيح أو منتهي الصلاحية";

function hashOTP(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });

  const { otp, newPassword } = parsed.data;
  const identifier = parsed.data.identifier.trim();

  // Resolve the account first — the OTP is only ever checked against one user's
  // token, so a 6-digit code alone can never unlock an arbitrary account.
  let userId: string | null = null;

  if (identifier.includes("@")) {
    const user = await prisma.user.findUnique({
      where: { email: identifier.toLowerCase() },
      select: { id: true },
    });
    userId = user?.id ?? null;
  } else {
    const school = await prisma.school.findFirst({
      where: { contactNumber: identifier },
      include: { users: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
    });
    userId = school?.users[0]?.id ?? null;
  }

  if (!userId) {
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const tokenRecord = await prisma.passwordResetToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    if (tokenRecord) {
      await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });
    }
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  if (tokenRecord.attempts >= MAX_ATTEMPTS) {
    await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });
    return Response.json(
      { error: "تم تجاوز عدد المحاولات المسموح بها. اطلب رمزاً جديداً." },
      { status: 429 }
    );
  }

  if (!hashesMatch(tokenRecord.tokenHash, hashOTP(otp))) {
    await prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { attempts: { increment: 1 } },
    });
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { password: hashedPassword },
    }),
    // Burn every outstanding token for this user, not just the one consumed.
    prisma.passwordResetToken.deleteMany({ where: { userId: tokenRecord.userId } }),
  ]);

  return Response.json({ success: true });
}
