import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const IS_PROD = env.NODE_ENV === "production";

/**
 * The `__Host-` prefix binds the cookie to this exact origin and forbids a
 * Domain attribute — the browser rejects it unless Secure + Path=/ are set.
 * Plain http in development cannot carry it, so the name differs per env.
 */
const COOKIE_NAME = IS_PROD ? "__Host-admin_token" : "admin_token";

const SECRET = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
const ISSUER = "daycare-admin";
const ROLE = "superadmin";
const MAX_AGE_SECONDS = 8 * 3600;

export async function signAdminToken(adminId: string): Promise<string> {
  return new SignJWT({ role: ROLE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(SECRET);
}

/**
 * Verifies the token *and* re-checks the account still exists. A deleted or
 * revoked super-admin must lose access immediately, not when the JWT expires.
 */
async function verifyToken(token: string): Promise<{ adminId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
    if (!payload.sub || payload.role !== ROLE) return null;

    const admin = await prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!admin) return null;

    return { adminId: admin.id };
  } catch {
    return null;
  }
}

export async function verifyAdminSession(): Promise<{ adminId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function verifyAdminSessionFromRequest(
  request: Request
): Promise<{ adminId: string } | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
  );
  if (!match) return null;
  return verifyToken(match[1]);
}

/** `Set-Cookie` value that establishes the admin session. */
export function buildAdminCookieHeader(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    IS_PROD ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** `Set-Cookie` value that clears the admin session. */
export function buildAdminLogoutCookieHeader(): string {
  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    IS_PROD ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
