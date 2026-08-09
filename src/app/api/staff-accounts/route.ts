import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { passwordSchema, BCRYPT_COST } from "@/lib/password-policy";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { mintInvite, accountState } from "@/lib/invitations";
import { env } from "@/lib/env";
import bcrypt from "bcryptjs";
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
      acceptedAt: true,
      inviteExpiresAt: true,
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
      // Four states, not one boolean: "never invited", "invited and waiting",
      // "invitation expired" and "signed in" each call for a different button.
      state: accountState(user),
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
   * An invitation, not a password.
   *
   * This route used to generate a password and email it in the clear, where it
   * then lived in an inbox for as long as the mailbox did — no expiry, and no
   * way to tell whether it had ever been used. An invitation expires in seven
   * days and is chosen by the person who will type it.
   *
   * A password may still be set directly, for the case where the owner is
   * standing next to a new member of staff and it is faster to agree one aloud.
   * That account is active immediately and needs no invitation.
   */
  const direct = parsed.data.password
    ? await bcrypt.hash(parsed.data.password, BCRYPT_COST)
    : null;
  const invite = direct ? null : mintInvite();

  const user = await prisma.user.create({
    data: {
      schoolId,
      name: parsed.data.name,
      email,
      password: direct,
      acceptedAt: direct ? new Date() : null,
      inviteTokenHash: invite?.tokenHash ?? null,
      inviteExpiresAt: invite?.expiresAt ?? null,
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
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    email,
    invite ? `دعوة للانضمام إلى ${school?.name ?? "الحضانة"}` : "تم إنشاء حسابك",
    (invite
      ? [
          `مرحباً ${parsed.data.name}،`,
          "",
          `دعتك ${school?.name ?? "الحضانة"} للانضمام بصلاحية: ${role.nameAr}`,
          "",
          "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
          appUrl ? `${appUrl}/activate/${invite.token}` : "",
          "",
          "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
        ]
      : [
          `مرحباً ${parsed.data.name}،`,
          "",
          `تم إنشاء حساب لك في ${school?.name ?? "الحضانة"} بصلاحية: ${role.nameAr}`,
          "",
          `البريد: ${email}`,
          // The password is not repeated here. It was agreed in person; putting
          // it in an inbox is the habit this change exists to end.
          "كلمة المرور هي التي اتُّفق عليها عند إنشاء الحساب.",
        ]
    )
      .filter(Boolean)
      .join("\n"),
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
