import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
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
  const email = session.user.email;
  if (!email) {
    return Response.json(
      { error: "يجب إضافة بريد إلكتروني إلى حسابك أولاً" },
      { status: 400 }
    );
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
      userId: session.user.id,
      purpose: "ACTIVATE",
      otpCodeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const delivery = await sendEmail(
    email,
    "رمز تفعيل التحقق بخطوتين",
    `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
    session.user.schoolName
  );

  if (!delivery.success) {
    await prisma.twoFASession.deleteMany({
      where: { id: twoFaSession.id, schoolId, purpose: "ACTIVATE" },
    });
    console.error("[2fa-activation] failed to deliver activation code", schoolId);
    return Response.json(
      { error: "تعذر إرسال رمز التحقق عبر البريد. حاول مجدداً." },
      { status: 502 }
    );
  }

  return Response.json({ twoFaSessionId: twoFaSession.id });
}
