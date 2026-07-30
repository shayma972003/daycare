import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  twoFaSessionId: z.string().min(1),
  otp_code: z.string().min(1),
});

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
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
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
    return Response.json({ error: "انتهت صلاحية رمز التحقق، الرجاء إعادة الإرسال" }, { status: 400 });
  }

  const isValid = await bcrypt.compare(otp_code, twoFaSession.otpCodeHash);
  if (!isValid) {
    await prisma.twoFASession.update({
      where: { id: twoFaSession.id },
      data: { attempts: { increment: 1 } },
    });
    return Response.json({ error: "رمز التحقق غير صحيح" }, { status: 400 });
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school?.phoneNumber) {
    return Response.json({ error: "يجب إضافة رقم الجوال في معلومات المنشأة أولاً" }, { status: 400 });
  }

  await Promise.all([
    prisma.twoFASession.update({ where: { id: twoFaSession.id }, data: { verified: true } }),
    prisma.school.update({
      where: { id: schoolId },
      data: { twoFaEnabled: true, twoFaPhone: `+966${school.phoneNumber}` },
    }),
  ]);

  await logAction({
    school_id: schoolId,
    action: "تفعيل التحقق بخطوتين",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
