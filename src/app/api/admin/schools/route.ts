import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import bcrypt from "bcryptjs";
import { z } from "zod";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const schools = await prisma.school.findMany({
    include: {
      subscription_plan: { select: { id: true, name: true, price: true } },
      _count: { select: { students: { where: { isActive: true } }, teachers: { where: { isActive: true } }, classes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(
    schools.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      plan: s.subscription_plan,
      subscription_status: s.subscription_status,
      renewal_date: s.renewal_date,
      last_login_at: s.last_login_at,
      createdAt: s.createdAt,
      studentCount: s._count.students,
      teacherCount: s._count.teachers,
      classCount: s._count.classes,
    }))
  );
}

const createSchema = z.object({
  schoolName: z.string().min(2, "اسم المنشأة مطلوب"),
  email: z.string().email("البريد الإلكتروني غير صالح"),
  contactNumber: z.string().optional(),
  planId: z.string().optional(),
});

function generateTempPassword(length = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });

  const { schoolName, email: rawEmail, contactNumber, planId } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    return Response.json({ error: "البريد الإلكتروني مستخدم بالفعل" }, { status: 409 });

  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  const school = await prisma.school.create({
    data: {
      name: schoolName,
      email,
      contactNumber: contactNumber ?? null,
      ...(planId ? { plan_id: planId } : {}),
    },
  });

  await prisma.user.create({
    data: { name: schoolName, email, password: hashedPassword, role: "admin", schoolId: school.id },
  });

  await prisma.adminActivityLog.create({
    data: { school_id: school.id, action: "school_created", performed_by: "super_admin", metadata: { email } },
  });

  // Send credentials by email (fire-and-forget — don't fail if email fails)
  sendEmail(
    email,
    "بيانات تسجيل الدخول — نظام إدارة الروضة",
    `مرحباً،\n\nتم إنشاء حسابكم في نظام إدارة الروضة.\n\nبيانات الدخول:\nالبريد الإلكتروني: ${email}\nكلمة المرور المؤقتة: ${tempPassword}\n\nيُرجى تغيير كلمة المرور بعد أول تسجيل دخول من صفحة الإعدادات.`,
    "نظام إدارة الروضة"
  ).catch(() => {});

  return Response.json({ id: school.id, name: school.name, email, tempPassword }, { status: 201 });
}
