import { prisma } from "@/lib/prisma";
import { sendEmail, sendWhatsApp } from "@/lib/notifications";
import { z } from "zod";
import { randomInt } from "crypto";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال"),
});

function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "أدخل البريد الإلكتروني أو رقم الجوال" }, { status: 422 });

  const { identifier } = parsed.data;
  const isEmail = identifier.includes("@");

  let user: { id: string; email: string; schoolId: string } | null = null;
  let sendTo: { email?: string; phone?: string } = {};

  if (isEmail) {
    const email = identifier.toLowerCase().trim();
    user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, schoolId: true } });
    if (user) sendTo = { email };
  } else {
    // Look up by school contact number
    const phone = identifier.trim();
    const school = await prisma.school.findFirst({
      where: { contactNumber: phone },
      include: { users: { take: 1, select: { id: true, email: true, schoolId: true } } },
    });
    if (school?.users[0]) {
      user = school.users[0];
      sendTo = { phone };
    }
  }

  // Always return success to prevent enumeration attacks
  if (!user) {
    return Response.json({ success: true });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Delete any existing tokens for this user
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token: otp, expiresAt },
  });

  const message = `رمز إعادة تعيين كلمة المرور: ${otp}\nصالح لمدة ساعة واحدة. لا تشاركه مع أحد.`;

  if (sendTo.email) {
    await sendEmail(sendTo.email, "رمز إعادة تعيين كلمة المرور", message, "نظام إدارة الروضة");
  }

  if (sendTo.phone) {
    await sendWhatsApp(sendTo.phone, message);
  }

  return Response.json({ success: true });
}
