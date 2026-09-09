import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { z } from "zod";
import { mintInvite } from "@/lib/invitations";
import { env } from "@/lib/env";
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { addSchoolBillingPeriod, schoolSubscriptionAccess } from "@/lib/school-subscription";

export type SchoolAdminInvitationStatus =
  | "active"
  | "pending"
  | "expired"
  | "revoked"
  | "none";

export function schoolAdminInvitationStatus(input: {
  acceptedAt: Date | null;
  passwordSet: boolean;
  invitation?: {
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
  } | null;
}, now = new Date()): SchoolAdminInvitationStatus {
  if (input.acceptedAt || input.passwordSet) return "active";
  if (!input.invitation || input.invitation.usedAt) return "none";
  if (input.invitation.revokedAt) return "revoked";
  if (input.invitation.expiresAt <= now) return "expired";
  return "pending";
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const schools = await prisma.school.findMany({
    include: {
      subscription_plan: { select: { id: true, name: true, price: true } },
      _count: { select: { students: { where: { isActive: true } }, teachers: { where: { isActive: true } }, classes: true } },
      users: {
        take: 1,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { acceptedAt: true, password: true },
      },
      school_admin_invitations: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { expiresAt: true, usedAt: true, revokedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  return Response.json(
    schools.map((s) => {
      const access = schoolSubscriptionAccess(s, now);
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        plan: s.subscription_plan,
        subscription_status: access.mode === "active" ? s.subscription_status : access.reason,
        renewal_date: access.renewalDate,
        last_login_at: s.last_login_at,
        createdAt: s.createdAt,
        studentCount: s._count.students,
        teacherCount: s._count.teachers,
        classCount: s._count.classes,
        invitation_status: schoolAdminInvitationStatus({
          acceptedAt: s.users[0]?.acceptedAt ?? null,
          passwordSet: Boolean(s.users[0]?.password),
          invitation: s.school_admin_invitations[0] ?? null,
        }),
      };
    })
  );
}

const createSchema = z.object({
  schoolName: z.string().min(2, "اسم المنشأة مطلوب"),
  email: z.string().email("البريد الإلكتروني غير صالح"),
  contactNumber: z.string().optional(),

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
    schoolName, email: rawEmail, contactNumber,
    legalName, commercialRegistration, nationalUnifiedNumber, entityType, businessActivities,
    schoolType, educationStages, licenseNumber, branch, address,
    vatRegistered, vatNumber, zatcaUnifiedNumber, zakatStatus, financialYear, taxPeriod,
  } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  const invitation = mintInvite();
  const createdAt = new Date();
  const trialEndsAt = addSchoolBillingPeriod(createdAt, "MONTHLY");

  let school: { id: string; name: string; userId: string };
  try {
    school = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new DuplicateAdminEmailError();

      const createdSchool = await tx.school.create({
        data: {
          name: schoolName,
          email,
          contactNumber: contactNumber ?? null,
          plan_id: null,
          subscription_status: "trial",
          renewal_date: trialEndsAt,
          createdAt,
          legalName, commercialRegistration, nationalUnifiedNumber, entityType, businessActivities,
          schoolType, educationStages, licenseNumber, branch, address,
          vatRegistered, vatNumber, zatcaUnifiedNumber, zakatStatus, financialYear, taxPeriod,
        },
        select: { id: true, name: true },
      });

      await tx.role.createMany({
        data: ROLE_TEMPLATES.map((role) => ({
          schoolId: createdSchool.id,
          key: role.key,
          nameAr: role.nameAr,
          permissions: role.permissions,
          isSystem: true,
        })),
      });
      const managerRole = await tx.role.findUnique({
        where: { schoolId_key: { schoolId: createdSchool.id, key: "manager" } },
        select: { id: true },
      });
      if (!managerRole) throw new Error("Manager role was not created");

      const createdUser = await tx.user.create({
        data: {
          name: schoolName,
          email,
          password: null,
          acceptedAt: null,
          role: "manager",
          roleId: managerRole.id,
          schoolId: createdSchool.id,
        },
        select: { id: true },
      });

      await tx.schoolAdminInvitation.create({
        data: {
          tokenHash: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
          schoolId: createdSchool.id,
          userId: createdUser.id,
        },
      });

      await tx.adminActivityLog.create({
        data: {
          school_id: createdSchool.id,
          action: "school_created",
          performed_by: "super_admin",
          metadata: {
            email,
            userId: createdUser.id,
            adminId: session.adminId,
            subscriptionType: "TRIAL",
            renewalDate: trialEndsAt,
          },
        },
      });

      return { ...createdSchool, userId: createdUser.id };
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

  const emailDelivery = await sendEmail(
    email,
    `دعوة لإدارة ${school.name}`,
    [
      `مرحباً،`,
      "",
      `تم إنشاء حساب مدير حضانة ${school.name}.`,
      "اختاري كلمة المرور الخاصة بك من الرابط التالي:",
      `${env.APP_URL}/activate/${invitation.token}`,
      "",
      "الرابط صالح لمدة 7 أيام ولا يعمل إلا مرة واحدة.",
    ].join("\n"),
    school.name
  );
  if (emailDelivery.status === "failed") {
    console.error("[admin-schools] invitation email delivery failed", {
      schoolId: school.id,
      provider: emailDelivery.provider,
      reason: emailDelivery.reason,
      providerStatus: emailDelivery.providerStatus ?? null,
    });
  }

  return Response.json(
    {
      id: school.id,
      name: school.name,
      email,
      invitationStatus: "pending",
      emailDelivery: emailDelivery.status,
      ...(emailDelivery.status === "failed" ? { emailDeliveryReason: emailDelivery.reason } : {}),
      subscriptionStatus: "trial",
      renewalDate: trialEndsAt.toISOString(),
    },
    {
      status: emailDelivery.success ? 201 : 207,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
