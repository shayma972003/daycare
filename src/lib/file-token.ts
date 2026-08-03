import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { keyFromUrl } from "@/lib/r2";

/**
 * Short-lived, single-key grants for `<img>` tags (task 0.34).
 *
 * The file route accepts a dashboard cookie or a mobile bearer token. Neither
 * reaches an image: `<img src>` sends no Authorization header, and the parent
 * portal is a browser page whose only credential *is* a bearer token held in
 * JavaScript. So a guardian's browser has no way to prove itself when the
 * markup fetches a photo.
 *
 * The answer is to have the endpoint that already authorised the guardian —
 * `/api/portal/me`, which has just checked that this child is theirs — stamp the
 * URLs it returns. The signature covers **one key** and expires in minutes, so
 * the grant it carries is exactly "this file, for a moment", not "anything in
 * this school, forever".
 *
 * The token is not personal data and identifies nobody: it is a MAC over a
 * storage key and a timestamp.
 */

/** Fifteen minutes: a page and its images load in seconds; a copied URL dies quickly. */
const DEFAULT_TTL_SECONDS = 900;

function sign(payload: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(payload).digest("base64url");
}

/** `<expiry>.<mac>` — the key is not repeated in the token, it is in the path. */
export function signFileToken(key: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${expiresAt}.${sign(`${key}:${expiresAt}`)}`;
}

/** True when `token` was issued for exactly this key and has not expired. */
export function verifyFileToken(key: string, token: string | null): boolean {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator < 1) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;

  const expected = Buffer.from(sign(`${key}:${expiresAt}`));
  const received = Buffer.from(token.slice(separator + 1));

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length is not a secret.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Adds a grant to a stored file URL, leaving anything else untouched.
 *
 * Legacy base64 data URIs and null values pass straight through, so a caller can
 * apply this to a whole response without first knowing which columns have been
 * migrated.
 */
export function stampFileUrl(
  url: string | null | undefined,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string | null {
  if (!url) return null;

  const key = keyFromUrl(url);
  if (!key) return url;

  return `${url}?t=${signFileToken(key, ttlSeconds)}`;
}
