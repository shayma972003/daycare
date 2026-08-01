import { randomBytes, randomInt, createHash, timingSafeEqual } from "crypto";

/**
 * Shared OTP handling for the public enrolment flow.
 *
 * This flow is the softest target in the product: an anonymous caller holding a
 * link can reach a form that collects a child's full identity. Previously the
 * code was stored in plaintext, compared with `!==`, generated with
 * `Math.random()`, and had no attempt counter behind a token valid for 24 hours
 * — six digits were brute-forceable in minutes.
 */

/** Guesses allowed per token before the code is burned. */
export const MAX_OTP_ATTEMPTS = 5;
/** Resends allowed per token, so one link cannot be used to spam a parent. */
export const MAX_OTP_RESENDS = 3;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** 24 random bytes → 32 unguessable base64url characters. */
export function generateEnrollmentToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Six digits from a CSPRNG — `Math.random()` is predictable from prior output. */
export function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

/** Constant-time comparison so response timing cannot leak a partial match. */
export function otpMatches(storedHash: string | null, candidate: string): boolean {
  if (!storedHash) return false;

  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashOtp(candidate), "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** Body used for both the initial send and every resend. */
export function buildOtpMessage(
  schoolName: string,
  otp: string,
  enrollUrl: string
): string {
  return [
    `مرحباً، تم إرسال نموذج تسجيل الطفل من ${schoolName}`,
    ``,
    `رمز التحقق: ${otp}`,
    `صالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
    ``,
    `رابط النموذج:`,
    enrollUrl,
    `الرابط صالح لمدة 24 ساعة.`,
  ].join("\n");
}
