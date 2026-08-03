import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { passwordSchema, BCRYPT_COST } from "@/lib/password-policy";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";

/**
 * Staff logins for the current school.
 *
 * Until now a nursery had exactly one account — the owner's — and everyone
 * shared it. Shared credentials make the audit log meaningless (every action is
 * "المدير") and mean a departing employee's access can only be revoked by
 * changing the password for the whole school.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  const users = await prisma.user.findMany({
    where: { schoolId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      teacherId: true,
      disabledAt: true,
      createdAt: true,
      roleRef: { select: { id: true, nameAr: true, permissions: true } },
    },
  });

  return Response.json(
    users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      teacherId: user.teacherId,
      disabled: Boolean(user.disabledAt),
      createdAt: user.createdAt,
      role: user.roleRef
        ? {
            id: user.roleRef.id,
            nameAr: user.roleRef.nameAr,
            isOwner: user.roleRef.permissions.includes(ALL_PERMISSIONS),
          }
        : null,
      // Never the hash, not even truncated.
      isSelf: user.id === session.user.id,
    }))
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  roleId: z.string().min(1),
  /** Optional: link the login to an existing staff record. */
  teacherId: z.string().nullish(),
  /** Omitted means "send them an invitation to set their own". */
  password: passwordSchema.optional(),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // `User.email` is globally unique, so a clash may be with another tenant. The
  // message says nothing about which — confirming an address exists elsewhere in
  // the system is an account-enumeration oracle.
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) {
    return Response.json({ error: "البريد مستخدم بالفعل" }, { status: 409 });
  }

  // The role must belong to this school — an id from the client is not proof.
  const role = await prisma.role.findFirst({
    where: { id: parsed.data.roleId, schoolId },
    select: { id: true, nameAr: true, permissions: true },
  });
  if (!role) {
    return Response.json({ error: "الدور غير موجود" }, { status: 404 });
  }

  // Escalation guard: creating an account that holds the wildcard would let a
  // manager mint a second owner. The owner role is assigned by registration and
  // by the migration, not through this route.
  if (role.permissions.includes(ALL_PERMISSIONS)) {
    return Response.json(
      { error: "لا يمكن إنشاء حساب بدور المدير من هنا" },
      { status: 403 }
    );
  }

  if (parsed.data.teacherId) {
    const teacher = await prisma.teacher.findFirst({
      where: { id: parsed.data.teacherId, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!teacher) {
      return Response.json({ error: "المعلم غير موجود" }, { status: 404 });
    }
  }

  /**
   * A generated password when none was given.
   *
   * `randomBytes`, never `Math.random()` — the same reason every other secret in
   * this codebase moved off it in task 0.19. The plaintext is emailed once and
   * never stored or logged.
   */
  const generated = parsed.data.password ?? randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(generated, BCRYPT_COST);

  const user = await prisma.user.create({
    data: {
      schoolId,
      name: parsed.data.name,
      email,
      password: passwordHash,
      role: "staff",
      roleId: role.id,
      teacherId: parsed.data.teacherId ?? null,
    },
    select: { id: true, name: true, email: true },
  });

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  // Best-effort: a mail failure must not undo an account that already exists.
  // The owner can reset the password from this screen if the message never
  // arrives.
  const delivered = await sendEmail(
    email,
    "تم إنشاء حسابك",
    [
      `مرحباً ${parsed.data.name}،`,
      "",
      `تم إنشاء حساب لك في ${school?.name ?? "الحضانة"} بصلاحية: ${role.nameAr}`,
      "",
      `البريد: ${email}`,
      `كلمة المرور المؤقتة: ${generated}`,
      "",
      "يرجى تغيير كلمة المرور بعد أول تسجيل دخول.",
    ].join("\n"),
    school?.name ?? ""
  );

  await logAction({
    school_id: schoolId,
    action: `إنشاء حساب موظف: ${user.name} (${role.nameAr})`,
    entity_type: "staff_account",
    entity_id: user.id,
    entity_name: user.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(
    { ...user, invitationSent: delivered.success },
    { status: 201 }
  );
}
