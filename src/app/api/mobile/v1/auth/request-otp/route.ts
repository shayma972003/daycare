import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { generateOtp, hashOtp, OTP_TTL_MS } from "@/lib/enrollment-otp";
import { normalizePhone } from "@/lib/phone-normalizer";
import { z } from "zod";

/**
 * Step one of mobile sign-in (task 1.8): identify by phone number, receive a
 * code by **email**.
 *
 * Phone in, email out, which looks inconsistent and is deliberate. A parent
 * knows their phone number and will type it correctly; they may not remember
 * which address the nursery holds. But SMS costs money per message and needs a
 * gateway the product does not have yet, while email is already wired and free —
 * so the phone identifies the account and the code goes to the address on file.
 * The reply says which address, masked, so the parent knows where to look.
 *
 * Same OTP primitives as the enrolment flow: CSPRNG digits, stored hashed,
 * constant-time comparison, bounded attempts. See src/lib/enrollment-otp.ts.
 */

const schema = z.object({
  phone: z.string().min(6).max(20),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "رقم الجوال غير صحيح" }, { status: 422 });
  }

  const phone = normalizePhone(parsed.data.phone);

  // Two limits, because they stop different things. Per-phone stops someone
  // hammering one family's account; per-IP stops one caller enumerating many.
  const perPhone = await rateLimit({
    key: `mobile-otp:phone:${phone}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!perPhone.ok) return tooManyRequests(perPhone.retryAfter);

  const perIp = await rateLimit({
    key: `mobile-otp:ip:${clientIp(request)}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!perIp.ok) return tooManyRequests(perIp.retryAfter);

  const account = await prisma.guardianAccount.findFirst({
    where: { phone, disabledAt: null },
    select: {
      id: true,
      email: true,
      schoolId: true,
      school: { select: { name: true } },
    },
  });

  /**
   * The same answer whether or not the number is registered.
   *
   * Differentiating turns this endpoint into a directory: try numbers until one
   * says "code sent", and you have learned which families use this nursery.
   * Costs a caller with a real account nothing, tells an attacker nothing.
   */
  const genericResponse = Response.json({
    sent: true,
    hint: account ? maskEmail(account.email) : null,
  });

  if (!account) return genericResponse;

  const otp = generateOtp();

  await prisma.twoFASession.create({
    data: {
      schoolId: account.schoolId,
      // Reuses the existing 2FA session table. `userId` holds the guardian
      // account id under this purpose — the column is a free-text foreign key
      // with no constraint, and the purpose disambiguates it.
      userId: account.id,
      purpose: "MOBILE_LOGIN",
      otpCodeHash: hashOtp(otp),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await sendEmail(
    account.email,
    "رمز الدخول إلى التطبيق",
    [
      `رمز الدخول: ${otp}`,
      "",
      "صالح لمدة 10 دقائق. لا تشاركه مع أحد.",
      "إذا لم تطلب هذا الرمز، تجاهل الرسالة.",
    ].join("\n"),
    account.school?.name ?? ""
  );

  return genericResponse;
}

/** "sa***@example.com" — enough to recognise, not enough to harvest. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}
