import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { BCRYPT_COST, passwordSchema } from "@/lib/password-policy";
import { oneTimeCodeMatches, rateLimitSubject } from "@/lib/one-time-code";
import { authJson, withNoStore } from "@/lib/auth-response";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال"),
  otp: z.string().length(6, "رمز التحقق يجب أن يكون 6 أرقام"),
  newPassword: passwordSchema,
  /** Defaults to staff so the existing web form remains backward-compatible. */
  kind: z.enum(["staff", "guardian"]).default("staff"),
});

const MAX_ATTEMPTS = 5;
const GENERIC_ERROR = "رمز التحقق غير صحيح أو منتهي الصلاحية";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return authJson({ error: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { otp, newPassword, kind } = parsed.data;
  const identifier = parsed.data.identifier.trim();
  const limited = await rateLimit({
    key: `reset:ip:${rateLimitSubject(clientIp(request))}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return withNoStore(limitedResponse);

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

  if (!subjectId) return authJson({ error: GENERIC_ERROR }, { status: 400 });

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
    return authJson({ error: GENERIC_ERROR }, { status: 400 });
  }

  if (tokenRecord.attempts >= MAX_ATTEMPTS) {
    await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });
    return authJson(
      { error: "تم تجاوز عدد المحاولات المسموح بها. اطلب رمزًا جديدًا." },
      { status: 429 }
    );
  }

  if (!(await oneTimeCodeMatches(tokenRecord.tokenHash, otp, "password-reset"))) {
    await prisma.passwordResetToken.updateMany({
      where: {
        id: tokenRecord.id,
        tokenHash: tokenRecord.tokenHash,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    return authJson({ error: GENERIC_ERROR }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const consumed = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.deleteMany({
      where: {
        id: tokenRecord.id,
        tokenHash: tokenRecord.tokenHash,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
        ...subjectWhere,
      },
    });
    if (claim.count !== 1) return false;

    if (kind === "guardian") {
      await tx.guardianAccount.update({
        where: { id: subjectId, acceptedAt: { not: null }, disabledAt: null },
        data: { passwordHash },
      });
      await tx.passwordResetToken.deleteMany({ where: { guardianAccountId: subjectId } });
      await tx.refreshToken.deleteMany({ where: { guardianAccountId: subjectId } });
    } else {
      await tx.user.update({
        where: { id: subjectId, acceptedAt: { not: null }, disabledAt: null },
        data: { password: passwordHash, authVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId: subjectId } });
      await tx.refreshToken.deleteMany({ where: { userId: subjectId } });
      await tx.twoFASession.deleteMany({ where: { userId: subjectId } });
    }
    return true;
  });

  if (!consumed) return authJson({ error: GENERIC_ERROR }, { status: 400 });

  return authJson({ success: true });
}
