import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/notifications";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
});

function generateOTP(): string {
  return String(randomInt(100000, 999999));
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

  const session = await prisma.twoFASession.findUnique({ where: { id: parsed.data.twoFaSessionId } });
  if (!session) {
    return Response.json({ error: "الجلسة غير موجودة" }, { status: 404 });
  }

  if (Date.now() - session.createdAt.getTime() < 60 * 1000) {
    return Response.json({ error: "الرجاء الانتظار قبل إعادة الإرسال" }, { status: 429 });
  }

  const school = await prisma.school.findUnique({ where: { id: session.schoolId } });
  const phone = session.purpose === "ACTIVATE"
    ? (school?.phoneNumber ? `+966${school.phoneNumber}` : null)
    : school?.twoFaPhone;
  if (!school || !phone) {
    return Response.json({ error: "تعذر إرسال الرمز" }, { status: 400 });
  }

  const otp = generateOTP();
  const otpCodeHash = await bcrypt.hash(otp, 10);

  const newSession = await prisma.twoFASession.create({
    data: {
      schoolId: session.schoolId,
      userId: session.userId,
      purpose: session.purpose,
      otpCodeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  await sendWhatsApp(phone, `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`);

  return Response.json({ success: true, twoFaSessionId: newSession.id });
}
