import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import { randomInt, createHash } from "crypto";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال"),
});

/** OTP is valid for 15 minutes — long enough to fetch an email, short enough to limit exposure. */
const OTP_TTL_MS = 15 * 60 * 1000;

function generateOTP(): string {
  return String(randomInt(100000, 1000000));
}

function hashOTP(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "أدخل البريد الإلكتروني أو رقم الجوال" }, { status: 422 });

  const identifier = parsed.data.identifier.trim();
  const isEmail = identifier.includes("@");

  let user: { id: string; email: string } | null = null;

  if (isEmail) {
    user = await prisma.user.findUnique({
      where: { email: identifier.toLowerCase() },
      select: { id: true, email: true },
    });
  } else {
    // Phone lookup resolves through the school's contact number.
    const school = await prisma.school.findFirst({
      where: { contactNumber: identifier },
      include: {
        users: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true },
        },
      },
    });
    user = school?.users[0] ?? null;
  }

  // Always report success — revealing whether an account exists is an enumeration oracle.
  if (!user) {
    return Response.json({ success: true });
  }

  const otp = generateOTP();

  // One live token per user: issuing a new code invalidates the previous one.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOTP(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    }),
  ]);

  await sendEmail(
    user.email,
    "رمز إعادة تعيين كلمة المرور",
    `رمز إعادة تعيين كلمة المرور: ${otp}\nصالح لمدة 15 دقيقة. لا تشاركه مع أحد.`,
    "نظام إدارة الروضة"
  );

  return Response.json({ success: true });
}
