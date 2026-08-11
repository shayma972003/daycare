import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { BCRYPT_COST } from "@/lib/password-policy";

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

  // Step 1 — Business identity
  legalName: z.string().optional(),
  commercialRegistration: z.string().optional(),
  nationalUnifiedNumber: z.string().optional(),
  entityType: z.string().optional(),
  businessActivities: z.string().optional(),

  // Step 2 — School information
  schoolType: z.string().optional(),
  educationStages: z.array(z.string()).optional(),
  licenseNumber: z.string().optional(),
  branch: z.string().optional(),
  address: z.string().optional(),

  // Step 3 — Tax & Zakat
  vatRegistered: z.boolean().optional(),
  vatNumber: z.string().optional(),
  zatcaUnifiedNumber: z.string().optional(),
  zakatStatus: z.enum(["yes", "no", "needs_review"]).optional(),
  financialYear: z.string().optional(),
  taxPeriod: z.string().optional(),
});

function generateTempPassword(): string {
  // 144 bits from the operating system CSPRNG; base64url is safe to copy from
  // an email and avoids punctuation commonly altered by clients.
  return randomBytes(18).toString("base64url");
}

class DuplicateAdminEmailError extends Error {}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
  );
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

  const {
    schoolName, email: rawEmail, contactNumber, planId,
    legalName, commercialRegistration, nationalUnifiedNumber, entityType, businessActivities,
    schoolType, educationStages, licenseNumber, branch, address,
    vatRegistered, vatNumber, zatcaUnifiedNumber, zakatStatus, financialYear, taxPeriod,
  } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_COST);

  let school: { id: string; name: string };
  try {
    school = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new DuplicateAdminEmailError();

      const createdSchool = await tx.school.create({
        data: {
          name: schoolName,
          email,
          contactNumber: contactNumber ?? null,
          ...(planId ? { plan_id: planId } : {}),
          legalName, commercialRegistration, nationalUnifiedNumber, entityType, businessActivities,
          schoolType, educationStages, licenseNumber, branch, address,
          vatRegistered, vatNumber, zatcaUnifiedNumber, zakatStatus, financialYear, taxPeriod,
        },
        select: { id: true, name: true },
      });

      await tx.user.create({
        data: {
          name: schoolName,
          email,
          password: hashedPassword,
          role: "admin",
          schoolId: createdSchool.id,
        },
      });

      await tx.adminActivityLog.create({
        data: {
          school_id: createdSchool.id,
          action: "school_created",
          performed_by: "super_admin",
          metadata: { email, adminId: session.adminId },
        },
      });

      return createdSchool;
    });
  } catch (error) {
    if (error instanceof DuplicateAdminEmailError || isUniqueConstraintError(error)) {
      return Response.json(
        { error: "البريد الإلكتروني مستخدم بالفعل" },
        { status: 409 }
      );
    }

    console.error("[admin-schools] creation failed");
    return Response.json({ error: "تعذر إنشاء الحضانة" }, { status: 500 });
  }

  // Send credentials by email (fire-and-forget — don't fail if email fails)
  sendEmail(
    email,
    "بيانات تسجيل الدخول — نظام إدارة الروضة",
    `مرحباً،\n\nتم إنشاء حسابكم في نظام إدارة الروضة.\n\nبيانات الدخول:\nالبريد الإلكتروني: ${email}\nكلمة المرور المؤقتة: ${tempPassword}\n\nيُرجى تغيير كلمة المرور بعد أول تسجيل دخول من صفحة الإعدادات.`,
    "نظام إدارة الروضة"
  ).catch(() => {
    // The account is committed already; report delivery failure internally
    // without logging the address or temporary credential.
    console.error("[admin-schools] credential email delivery failed", school.id);
  });

  return Response.json(
    { id: school.id, name: school.name, email, tempPassword },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
