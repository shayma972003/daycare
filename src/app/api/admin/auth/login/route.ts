import { prisma } from "@/lib/prisma";
import { signAdminToken, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

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

  const { email, password } = parsed.data;
  const admin = await prisma.superAdmin.findUnique({ where: { email } });
  if (!admin) {
    return Response.json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    return Response.json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status: 401 });
  }

  const token = await signAdminToken(admin.id);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${8 * 3600}; SameSite=Lax`,
    },
  });
}
