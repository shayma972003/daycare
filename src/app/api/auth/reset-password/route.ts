import { createHash, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { BCRYPT_COST, passwordSchema } from "@/lib/password-policy";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال"),
  otp: z.string().length(6, "رمز التحقق يجب أن يكون 6 أرقام"),
  newPassword: passwordSchema,
  /** Defaults to staff so the existing web form remains backward-compatible. */
  kind: z.enum(["staff", "guardian"]).default("staff"),
});

const MAX_ATTEMPTS = 5;
const GENERIC_ERROR = "رمز التحقق غير صحيح أو منتهي الصلاحية";

function hashOTP(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
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
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { otp, newPassword, kind } = parsed.data;
  const identifier = parsed.data.identifier.trim();
  const limited = await rateLimit({
    key: `reset:ip:${clientIp(request)}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  let subjectId: string | null = null;
  if (kind === "guardian") {
    const account = identifier.includes("@")
      ? await prisma.guardianAccount.findUnique({
          where: { email: identifier.toLowerCase() },
          select: { id: true, acceptedAt: true, disabledAt: true },
        })
      : null;
    subjectId = account?.acceptedAt && !account.disabledAt ? account.id : null;
  } else if (identifier.includes("@")) {
    const user = await prisma.user.findUnique({
      where: { email: identifier.toLowerCase() },
      select: { id: true, acceptedAt: true, disabledAt: true },
    });
    subjectId = user?.acceptedAt && !user.disabledAt ? user.id : null;
  } else {
    const school = await prisma.school.findFirst({
      where: { contactNumber: identifier },
      include: {
        users: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { id: true, acceptedAt: true, disabledAt: true },
        },
      },
    });
    const owner = school?.users[0];
    subjectId = owner?.acceptedAt && !owner.disabledAt ? owner.id : null;
  }

  if (!subjectId) return Response.json({ error: GENERIC_ERROR }, { status: 400 });

  const subjectWhere =
    kind === "guardian"
      ? { guardianAccountId: subjectId }
      : { userId: subjectId };
  const tokenRecord = await prisma.passwordResetToken.findFirst({
    where: subjectWhere,
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
      { error: "تم تجاوز عدد المحاولات المسموح بها. اطلب رمزًا جديدًا." },
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

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  if (kind === "guardian") {
    await prisma.$transaction([
      prisma.guardianAccount.update({
        where: { id: subjectId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.deleteMany({ where: { guardianAccountId: subjectId } }),
      prisma.refreshToken.deleteMany({ where: { guardianAccountId: subjectId } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: subjectId },
        data: { password: passwordHash },
      }),
      prisma.passwordResetToken.deleteMany({ where: { userId: subjectId } }),
    ]);
  }

  return Response.json({ success: true });
}
