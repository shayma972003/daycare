import { randomBytes } from "node:crypto";

export const ENROLLMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** An opaque, non-sequential capability used by the emailed public link. */
export function generateEnrollmentToken(): string {
  return randomBytes(24).toString("base64url");
}
