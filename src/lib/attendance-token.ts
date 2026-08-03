import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stampFileUrl } from "@/lib/file-token";

/**
 * The walk-up attendance kiosk is unauthenticated by design — staff scan a
 * printed QR and tap a name. What guards it is this token.
 *
 * The route used to key off the school id, which is embedded in dashboard URLs
 * and never changes. Anyone who saw it once had permanent, unrevocable access to
 * every child's name, photo and class. An opaque random token fixes both halves:
 * it cannot be guessed from anything else the school exposes, and rotating it
 * instantly invalidates every copy that leaked.
 */

/** 24 random bytes → 32 base64url chars. */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface AttendanceSchool {
  id: string;
  name: string;
  logoUrl: string | null;
}

/** Resolves a kiosk token to its school, or null when unknown. */
export async function resolveAttendanceToken(
  token: string
): Promise<AttendanceSchool | null> {
  if (!token || token.length < 16) return null;

  const school = await prisma.school.findUnique({
    where: { attendanceToken: token },
    select: { id: true, name: true, logoUrl: true },
  });
  if (!school) return null;

  // The kiosk has no session — that is the whole point of it — so the logo, now
  // a private object in R2, has to arrive with its own short-lived grant or the
  // screen shows a broken image. Validating the kiosk token *is* the
  // authorisation; this converts it into one the browser can use.
  return { ...school, logoUrl: stampFileUrl(school.logoUrl) };
}

/** Returns the school's kiosk token, minting one on first use. */
export async function ensureAttendanceToken(schoolId: string): Promise<string> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { attendanceToken: true },
  });

  if (school?.attendanceToken) return school.attendanceToken;

  return rotateAttendanceToken(schoolId);
}

/** Issues a fresh token, invalidating every previously printed QR code. */
export async function rotateAttendanceToken(schoolId: string): Promise<string> {
  const token = generateToken();

  await prisma.school.update({
    where: { id: schoolId },
    data: { attendanceToken: token, attendanceTokenCreatedAt: new Date() },
  });

  return token;
}
