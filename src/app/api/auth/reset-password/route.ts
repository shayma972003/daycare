import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  otp: z.string().length(6, "رمز التحقق يجب أن يكون 6 أرقام"),
  newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });

  const { otp, newPassword } = parsed.data;

  const tokenRecord = await prisma.passwordResetToken.findUnique({ where: { token: otp } });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    // Delete expired token if found
    if (tokenRecord) await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });
    return Response.json({ error: "رمز التحقق غير صحيح أو منتهي الصلاحية" }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: tokenRecord.userId },
    data: { password: hashedPassword },
  });

  await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });

  return Response.json({ success: true });
}
