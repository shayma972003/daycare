import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const admin = await prisma.superAdmin.findUnique({ where: { id: session.adminId } });
  if (!admin) return Response.json({ error: "Not found" }, { status: 404 });

  const valid = await bcrypt.compare(parsed.data.currentPassword, admin.password_hash);
  if (!valid) return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 401 });

  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.superAdmin.update({ where: { id: admin.id }, data: { password_hash: hash } });

  await prisma.adminActivityLog.create({
    data: { action: "admin_password_changed", performed_by: "super_admin" },
  });

  return Response.json({ success: true });
}
