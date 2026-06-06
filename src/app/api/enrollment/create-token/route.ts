import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendWhatsApp, sendEmail } from "@/lib/notifications";
import { z } from "zod";

const schema = z.object({
  phone: z.string().min(9),
  email: z.string().email().optional().or(z.literal("")),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("966")) return `+${digits}`;
  if (digits.startsWith("0")) return `+966${digits.slice(1)}`;
  return `+966${digits}`;
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const { phone, email } = parsed.data;
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = email && email.length > 0 ? email : null;

  await markExpiredTokens(schoolId);

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const enrollmentToken = await prisma.enrollmentToken.create({
    data: {
      school_id: schoolId,
      sent_to_phone: normalizedPhone,
      sent_to_email: normalizedEmail,
      otp_code: otp,
      otp_expires_at: otpExpiresAt,
      expires_at: expiresAt,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const enrollUrl = `${appUrl}/enroll/${enrollmentToken.token}`;
  const message = `مرحباً، تم إرسال نموذج تسجيل الطالب من ${school.name}\nرمز التحقق: ${otp}\nرابط النموذج: ${enrollUrl}\nصالح لمدة 24 ساعة`;

  sendWhatsApp(normalizedPhone, message).catch(() => {});

  if (normalizedEmail) {
    sendEmail(normalizedEmail, `نموذج تسجيل — ${school.name}`, message, school.name).catch(() => {});
  }

  return Response.json({ success: true, phone: normalizedPhone });
}
