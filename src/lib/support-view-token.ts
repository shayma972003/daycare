import { jwtVerify, SignJWT } from "jose";

const IS_PROD = process.env.NODE_ENV === "production";
export const SUPPORT_VIEW_COOKIE_NAME = IS_PROD ? "__Host-support_view" : "support_view";
const ISSUER = "daycare-support-view";
const AUDIENCE = "daycare-tenant-dashboard";

export interface SupportViewClaims {
  accessId: string;
  adminId: string;
  schoolId: string;
  expiresAt: Date;
}

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is required");
  return new TextEncoder().encode(value);
}

export async function signSupportViewToken(claims: SupportViewClaims): Promise<string> {
  return new SignJWT({
    supportAccessId: claims.accessId,
    supportAdminId: claims.adminId,
    schoolId: claims.schoolId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(claims.expiresAt.getTime() / 1000))
    .sign(secret());
}

export async function verifySupportViewToken(token: string): Promise<SupportViewClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.supportAccessId !== "string" ||
      typeof payload.supportAdminId !== "string" ||
      typeof payload.schoolId !== "string" ||
      typeof payload.exp !== "number"
    ) return null;
    return {
      accessId: payload.supportAccessId,
      adminId: payload.supportAdminId,
      schoolId: payload.schoolId,
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}

export function buildSupportViewCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${SUPPORT_VIEW_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    IS_PROD ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearSupportViewCookie(): string {
  return [
    `${SUPPORT_VIEW_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    IS_PROD ? "Secure" : "",
  ].filter(Boolean).join("; ");
}
