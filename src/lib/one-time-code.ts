import { createHash, createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

const HASH_PREFIX = "hmac-v1:";
const LEGACY_ACCEPT_UNTIL = new Date("2026-09-01T00:00:00.000Z");

export type OneTimeCodePurpose =
  | "2fa-login"
  | "2fa-activate"
  | "password-reset"
  | "enrollment";

function pepper(): string {
  // Production requires the independent key. Development/test retain a clear,
  // safe compatibility path through the already-required authentication key.
  const value = process.env.OTP_HASH_PEPPER ?? process.env.NEXTAUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "test") return "test-only-otp-pepper-never-used-in-production";
  throw new Error("OTP hashing is unavailable: configure OTP_HASH_PEPPER");
}

function digest(code: string, purpose: OneTimeCodePurpose): string {
  return createHmac("sha256", pepper())
    .update(`daycare:otp:${purpose}:`)
    .update(code)
    .digest("hex");
}

export function hashOneTimeCode(code: string, purpose: OneTimeCodePurpose): string {
  return `${HASH_PREFIX}${digest(code, purpose)}`;
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/** Transitional verification for codes issued before HMAC rollout. */
export async function oneTimeCodeMatches(
  storedHash: string | null,
  candidate: string,
  purpose: OneTimeCodePurpose,
  now = new Date()
): Promise<boolean> {
  if (!storedHash) return false;

  if (storedHash.startsWith(HASH_PREFIX)) {
    return equalHex(storedHash.slice(HASH_PREFIX.length), digest(candidate, purpose));
  }

  // The compatibility path has a hard stop and cannot become a permanent
  // downgrade. Existing codes expire long before this date.
  if (now >= LEGACY_ACCEPT_UNTIL) return false;
  if (storedHash.startsWith("$2")) return bcrypt.compare(candidate, storedHash);

  const legacy = createHash("sha256").update(candidate).digest("hex");
  return equalHex(storedHash, legacy);
}

export function isVersionedOneTimeCodeHash(value: string): boolean {
  return value.startsWith(HASH_PREFIX);
}

/** Opaque limiter component for emails, IPs and other identifying inputs. */
export function rateLimitSubject(value: string): string {
  return createHmac("sha256", pepper())
    .update("daycare:rate-limit-subject:")
    .update(value.trim().toLowerCase())
    .digest("base64url")
    .slice(0, 32);
}
