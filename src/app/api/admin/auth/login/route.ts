import { prisma } from "@/lib/prisma";
import { signAdminToken, buildAdminCookieHeader } from "@/lib/admin-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Constant-time-ish guard against user enumeration: when no admin matches we
 * still run a bcrypt comparison against a dummy hash so the response time does
 * not reveal whether the email exists.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.iVMhrpZ9zXBcVBrEXvXJZgFqbrJmZ7q";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const { password } = parsed.data;

  const admin = await prisma.superAdmin.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);

  if (!admin || !valid) {
    return Response.json(
      { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" },
      { status: 401 }
    );
  }

  const token = await signAdminToken(admin.id);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildAdminCookieHeader(token),
    },
  });
}
