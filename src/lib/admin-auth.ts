import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "admin_token";
const SECRET = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET ?? "admin-jwt-secret");

export async function signAdminToken(adminId: string): Promise<string> {
  return new SignJWT({ sub: adminId, role: "superadmin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(SECRET);
}

export async function verifyAdminSession(): Promise<{ adminId: string } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub) return null;
    return { adminId: payload.sub };
  } catch {
    return null;
  }
}

export async function verifyAdminSessionFromRequest(request: Request): Promise<{ adminId: string } | null> {
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (!match) return null;
    const token = match[1];
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub) return null;
    return { adminId: payload.sub };
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
