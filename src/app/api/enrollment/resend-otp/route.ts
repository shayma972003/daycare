import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/notifications";
import { z } from "zod";

const schema = z.object({ token: z.string().min(1) });

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });

  const { token } = parsed.data;

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true } } },
  });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.enrollmentToken.update({
    where: { token },
    data: { otp_code: otp, otp_expires_at: otpExpiresAt },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const enrollUrl = `${appUrl}/enroll/${token}`;
  const message = `مرحباً، رمز التحقق الجديد من ${rec.school.name}\nرمز التحقق: ${otp}\nرابط النموذج: ${enrollUrl}\nصالح 10 دقائق`;

  sendWhatsApp(rec.sent_to_phone, message).catch(() => {});

  return Response.json({ success: true });
}
