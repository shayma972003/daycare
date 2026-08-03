import { z } from "zod";

/**
 * One password policy for the whole product.
 *
 * The rules were duplicated per route and had drifted: registration and the
 * super-admin panel required 8 characters at bcrypt cost 12, while the tenant's
 * own "change password" screen accepted 6 at cost 10. The weakest path is the
 * one that decides the real security of the account, and it was the one a school
 * admin uses most.
 *
 * Cost 12 everywhere. It is roughly four times the work of cost 10 per hash —
 * irrelevant on a login (~250ms once), decisive against an offline attack on a
 * leaked table.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const BCRYPT_COST = 12;

export const PASSWORD_MIN_MESSAGE = `كلمة المرور يجب أن تكون ${PASSWORD_MIN_LENGTH} أحرف على الأقل`;

/** Zod field for any route that accepts a new password. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE);

/** Client-side check, so a form can fail fast with the same wording. */
export function isPasswordAcceptable(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH;
}
