import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { logAction } from "@/lib/activity-logger";
import { normalizePhone } from "@/lib/phone-normalizer";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import {
  generateEnrollmentToken,
  generateOtp,
  hashOtp,
  buildOtpMessage,
  OTP_TTL_MS,
  TOKEN_TTL_MS,
} from "@/lib/enrollment-otp";
import { z } from "zod";

const schema = z.object({
  /**
   * Optional, and no longer asked for.
   *
   * The invite used to require a number that nothing then used: there is no SMS
   * channel, it was never copied onto the guardian's record, and it was never
   * prefilled into the form. A required field that does nothing is a step the
   * user pays for and gets nothing back. Still accepted so older clients keep
   * working.
   */
  phone: z.string().min(9).optional(),
  // Required: email is the only delivery channel, so a token with no address
  // would be created and then never reach anyone.
  email: z.string().email("البريد الإلكتروني غير صالح"),
});

async function markExpiredTokens(schoolId: string) {
  await prisma.enrollmentToken.updateMany({
    where: {
      school_id: schoolId,
      expires_at: { lt: new Date() },
      status: { not: "completed" },
    },
    data: { status: "expired" },
  });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 422 }
    );
  }

  // Each invite sends mail on the platform's account, so a compromised staff
  // login cannot be turned into a bulk mailer.
  const limited = await rateLimit({
    key: `enroll:create:${schoolId}`,
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const { phone, email } = parsed.data;

  // Only validated when one is sent. Uses the shared normaliser rather than a
  // second local copy that blindly prefixed +966 onto whatever digits it was
  // given.
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (phone && !normalizedPhone) {
    return Response.json({ error: "رقم الجوال غير صالح" }, { status: 422 });
  }

  await markExpiredTokens(schoolId);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  const otp = generateOtp();
  const now = new Date();

  const enrollmentToken = await prisma.enrollmentToken.create({
    data: {
      school_id: schoolId,
      token: generateEnrollmentToken(),
      sent_to_phone: normalizedPhone,
      sent_to_email: email,
      otp_code_hash: hashOtp(otp),
      otp_expires_at: new Date(now.getTime() + OTP_TTL_MS),
      otp_last_sent_at: now,
      expires_at: new Date(now.getTime() + TOKEN_TTL_MS),
    },
  });

  const enrollUrl = `${env.APP_URL}/enroll/${enrollmentToken.token}`;
  const sent = await sendEmail(
    email,
    `نموذج تسجيل — ${school.name}`,
    buildOtpMessage(school.name, otp, enrollUrl),
    school.name
  );

  if (!sent.success) {
    // Leaving a token behind that no one can reach only creates confusion later.
    await prisma.enrollmentToken.delete({ where: { id: enrollmentToken.id } });
    return Response.json(
      { error: "تعذر إرسال البريد. تحقق من إعدادات البريد وحاول مجدداً." },
      { status: 502 }
    );
  }

  await logAction({
    school_id: schoolId,
    action: `إرسال نموذج تسجيل إلى: ${email}`,
    entity_type: "enrollment",
    entity_id: enrollmentToken.id,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, email });
}
