import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";
import { authJson, withNoStore } from "@/lib/auth-response";
import { oneTimeCodeMatches } from "@/lib/one-time-code";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
  otp_code: z.string().min(1),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return withNoStore(
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const limitedResponse = rateLimitResponse(
    await rateLimit({ key: `2fa:activate:${schoolId}:${session.user.id}`, limit: 10, windowMs: 15 * 60 * 1000 })
  );
  if (limitedResponse) return withNoStore(limitedResponse);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return authJson({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const { twoFaSessionId, otp_code } = parsed.data;

  const twoFaSession = await prisma.twoFASession.findUnique({ where: { id: twoFaSessionId } });

  if (
    !twoFaSession ||
    twoFaSession.schoolId !== schoolId ||
    twoFaSession.purpose !== "ACTIVATE" ||
    twoFaSession.verified ||
    twoFaSession.expiresAt < new Date() ||
    twoFaSession.attempts >= 5
  ) {
    return authJson({ error: "انتهت صلاحية رمز التحقق، الرجاء إعادة الإرسال" }, { status: 400 });
  }

  const now = new Date();
  const isValid = await oneTimeCodeMatches(
    twoFaSession.otpCodeHash,
    otp_code,
    "2fa-activate",
    now
  );
  if (!isValid) {
    await prisma.twoFASession.updateMany({
      where: {
        id: twoFaSession.id,
        schoolId,
        verified: false,
        expiresAt: { gt: now },
        attempts: { lt: 5 },
        otpCodeHash: twoFaSession.otpCodeHash,
      },
      data: { attempts: { increment: 1 } },
    });
    return authJson({ error: "رمز التحقق غير صحيح" }, { status: 400 });
  }

  const activated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.twoFASession.updateMany({
      where: {
        id: twoFaSession.id,
        schoolId,
        purpose: "ACTIVATE",
        verified: false,
        expiresAt: { gt: now },
        attempts: { lt: 5 },
        otpCodeHash: twoFaSession.otpCodeHash,
      },
      data: { verified: true },
    });
    if (claimed.count !== 1) return false;
    await tx.school.update({ where: { id: schoolId }, data: { twoFaEnabled: true } });
    return true;
  });
  if (!activated) return authJson({ error: "انتهت صلاحية رمز التحقق" }, { status: 409 });

  await logAction({
    school_id: schoolId,
    action: "تفعيل التحقق بخطوتين",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return authJson({ success: true });
}
