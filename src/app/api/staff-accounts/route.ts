import { requireSession, sessionErrorResponse } from "@/lib/session";
import { assertCan } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { mintInvite, accountState } from "@/lib/invitations";
import { env } from "@/lib/env";
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

const createSchema = z
  .object({
    name: z.string().min(1).max(80),
    email: z.string().email(),
    roleId: z.string().min(1),
    /** Optional: link the login to an existing staff record. */
    teacherId: z.string().nullish(),
  })
  .strict();

function isEmailConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
    return false;
  }

  const meta = "meta" in error ? error.meta : null;
  if (!meta || typeof meta !== "object") {
    return false;
  }

  // Prisma's binary engine exposes `meta.target`; the current PostgreSQL
  // driver adapter nests the constraint fields under `driverAdapterError`.
  // Inspect field/index names only, never the database message or submitted address.
  const conflictMeta = meta as {
    target?: unknown;
    driverAdapterError?: {
      cause?: { constraint?: { fields?: unknown; index?: unknown } };
    };
  };
  const constraint = conflictMeta.driverAdapterError?.cause?.constraint;
  const candidates = [conflictMeta.target, constraint?.fields, constraint?.index].flat();
  return candidates.some(
    (candidate) => typeof candidate === "string" && candidate.toLowerCase().includes("email")
  );
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
    assertCan(session, "staff.manage");
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

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  const invite = mintInvite();
  let user: { id: string; name: string; email: string };
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          schoolId,
          name: parsed.data.name,
          email,
          password: null,
          acceptedAt: null,
          inviteTokenHash: invite.tokenHash,
          inviteExpiresAt: invite.expiresAt,
          role: "staff",
          roleId: role.id,
          teacherId: parsed.data.teacherId ?? null,
        },
        select: { id: true, name: true, email: true },
      });

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `إنشاء حساب موظف: ${created.name} (${role.nameAr})`,
          entity_type: "staff_account",
          entity_id: created.id,
          entity_name: created.name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });

      return created;
    });
  } catch (error) {
    // The unique constraint is the race barrier. The response does not reveal
    // whether the matching address belongs to this tenant or another one.
    if (isEmailConflict(error)) {
      return Response.json({ error: "البريد مستخدم بالفعل" }, { status: 409 });
    }
    throw error;
  }

  // Delivery happens after the transaction. A provider failure leaves the
  // pending account and hashed invitation available for an explicit resend.
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    email,
    `دعوة للانضمام إلى ${school?.name ?? "الحضانة"}`,
    [
      `مرحباً ${parsed.data.name}،`,
      "",
      `دعتك ${school?.name ?? "الحضانة"} للانضمام بصلاحية: ${role.nameAr}`,
      "",
      "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
      appUrl ? `${appUrl}/activate/${invite.token}` : "",
      "",
      "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
    ]
      .filter(Boolean)
      .join("\n"),
    school?.name ?? ""
  );

  return Response.json(
    {
      ...user,
      invitationSent: delivered.success,
      deliveryStatus: delivered.success ? "sent" : "failed",
    },
    { status: delivered.success ? 201 : 207 }
  );
}
