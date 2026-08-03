import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/notifications";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

export async function POST() {
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

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school?.phoneNumber) {
    return Response.json({ error: "يجب إضافة رقم الجوال في معلومات المنشأة أولاً" }, { status: 400 });
  }

  const lastSession = await prisma.twoFASession.findFirst({
    where: { schoolId, purpose: "ACTIVATE" },
    orderBy: { createdAt: "desc" },
  });
  if (lastSession && Date.now() - lastSession.createdAt.getTime() < 60 * 1000) {
    return Response.json({ error: "الرجاء الانتظار قبل إعادة الإرسال" }, { status: 429 });
  }

  const otp = generateOTP();
  const otpCodeHash = await bcrypt.hash(otp, 10);

  const twoFaSession = await prisma.twoFASession.create({
    data: {
      schoolId,
      purpose: "ACTIVATE",
      otpCodeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  await sendWhatsApp(
    `+966${school.phoneNumber}`,
    `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`
  );

  return Response.json({ twoFaSessionId: twoFaSession.id });
}
