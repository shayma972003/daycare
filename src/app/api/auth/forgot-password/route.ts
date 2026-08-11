import { createHash, randomInt } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  identifier: z.string().min(1, "أدخل البريد الإلكتروني أو رقم الجوال").optional(),
  email: z.string().email().optional(),
  /** Defaults to staff so the existing web form keeps its current contract. */
  kind: z.enum(["staff", "guardian"]).default("staff"),
}).superRefine((value, context) => {
  if (value.kind === "guardian" && !value.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "أدخل البريد الإلكتروني" });
  }
  if (value.kind === "staff" && !value.identifier) {
    context.addIssue({ code: "custom", path: ["identifier"], message: "أدخل البريد الإلكتروني أو رقم الجوال" });
  }
});

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
  if (!parsed.success) {
    return Response.json({ error: "أدخل البريد الإلكتروني أو رقم الجوال" }, { status: 422 });
  }

  const kind = parsed.data.kind;
  const identifier = kind === "guardian"
    ? parsed.data.email!.trim()
    : parsed.data.identifier!.trim();

  for (const key of [
    `forgot:${kind}:id:${identifier.toLowerCase()}`,
    `forgot:ip:${clientIp(request)}`,
  ]) {
    const limited = await rateLimit({ key, limit: 5, windowMs: 15 * 60 * 1000 });
    if (!limited.ok) return tooManyRequests(limited.retryAfter);
  }

  const isEmail = identifier.includes("@");
  let subject: {
    id: string;
    email: string;
    acceptedAt: Date | null;
    disabledAt: Date | null;
  } | null = null;

  if (kind === "guardian") {
    // Guardian recovery is email-only. Unknown identifiers and phone numbers
    // receive the same public response to avoid account enumeration.
    subject = isEmail
      ? await prisma.guardianAccount.findUnique({
          where: { email: identifier.toLowerCase() },
          select: { id: true, email: true, acceptedAt: true, disabledAt: true },
        })
      : null;
  } else if (isEmail) {
    subject = await prisma.user.findUnique({
      where: { email: identifier.toLowerCase() },
      select: { id: true, email: true, acceptedAt: true, disabledAt: true },
    });
  } else {
    const school = await prisma.school.findFirst({
      where: { contactNumber: identifier },
      include: {
        users: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true, acceptedAt: true, disabledAt: true },
        },
      },
    });
    subject = school?.users[0] ?? null;
  }

  // Always report success for unknown, pending, or disabled accounts.
  if (!subject || !subject.acceptedAt || subject.disabledAt) {
    return Response.json({ success: true });
  }

  const otp = generateOTP();
  const subjectWhere =
    kind === "guardian"
      ? { guardianAccountId: subject.id }
      : { userId: subject.id };

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: subjectWhere }),
    prisma.passwordResetToken.create({
      data: {
        ...subjectWhere,
        tokenHash: hashOTP(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    }),
  ]);

  const delivery = await sendEmail(
    subject.email,
    "رمز إعادة تعيين كلمة المرور",
    `رمز إعادة تعيين كلمة المرور: ${otp}\nصالح لمدة 15 دقيقة. لا تشاركه مع أحد.`,
    "نظام إدارة الروضة"
  );

  if (!delivery.success) {
    await prisma.passwordResetToken.deleteMany({ where: subjectWhere });
    console.error("[forgot-password] failed to deliver reset code", { kind });
    return Response.json(
      { error: "تعذر إرسال رمز إعادة التعيين. حاول مجددًا." },
      { status: 502 }
    );
  }

  return Response.json({ success: true });
}
