import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { passwordSchema, BCRYPT_COST } from "@/lib/password-policy";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  roleId: z.string().min(1).optional(),
  teacherId: z.string().nullish(),
  disabled: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const target = await prisma.user.findFirst({
    where: { id, schoolId },
    include: { roleRef: { select: { permissions: true } } },
  });
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });

  const targetIsOwner = target.roleRef?.permissions.includes(ALL_PERMISSIONS) ?? false;

  /**
   * The owner's account cannot be demoted or disabled from here.
   *
   * Without this a manager could disable the owner, or move them onto a role
   * with no `settings.manage`, and nobody would be left able to undo it — the
   * school would need support intervention to get back into its own product.
   */
  if (targetIsOwner && (parsed.data.roleId || parsed.data.disabled !== undefined)) {
    return Response.json(
      { error: "لا يمكن تعديل دور حساب المدير أو تعطيله" },
      { status: 409 }
    );
  }

  // Locking yourself out is the other easy way to need support. Refused
  // explicitly rather than left to be discovered.
  if (target.id === session.user.id && parsed.data.disabled === true) {
    return Response.json({ error: "لا يمكنك تعطيل حسابك" }, { status: 409 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;

  if (parsed.data.roleId) {
    const role = await prisma.role.findFirst({
      where: { id: parsed.data.roleId, schoolId },
      select: { id: true, permissions: true },
    });
    if (!role) return Response.json({ error: "الدور غير موجود" }, { status: 404 });
    // Same escalation guard as creation: the wildcard is not grantable here.
    if (role.permissions.includes(ALL_PERMISSIONS)) {
      return Response.json({ error: "لا يمكن منح دور المدير من هنا" }, { status: 403 });
    }
    data.roleId = role.id;
  }

  if ("teacherId" in parsed.data) {
    if (parsed.data.teacherId) {
      const teacher = await prisma.teacher.findFirst({
        where: { id: parsed.data.teacherId, schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!teacher) return Response.json({ error: "المعلم غير موجود" }, { status: 404 });
      data.teacherId = teacher.id;
    } else {
      data.teacherId = null;
    }
  }

  if (parsed.data.disabled !== undefined) {
    data.disabledAt = parsed.data.disabled ? new Date() : null;
  }

  if (parsed.data.password) {
    data.password = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, disabledAt: true },
  });

  /**
   * Disabling revokes immediately.
   *
   * The web session is a JWT, so it stays cryptographically valid until it
   * expires — `requireSession()` re-reads `disabledAt` on every request, which is
   * what actually stops them. Mobile sessions are different: a refresh token is a
   * database row, so it must be revoked here or the app would keep minting fresh
   * access tokens for a disabled account.
   */
  if (parsed.data.disabled === true) {
    await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await logAction({
    school_id: schoolId,
    action: parsed.data.disabled === true
      ? `تعطيل حساب موظف: ${updated.name}`
      : parsed.data.disabled === false
        ? `تفعيل حساب موظف: ${updated.name}`
        : `تعديل حساب موظف: ${updated.name}`,
    entity_type: "staff_account",
    entity_id: updated.id,
    entity_name: updated.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ ...updated, disabled: Boolean(updated.disabledAt) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const target = await prisma.user.findFirst({
    where: { id, schoolId },
    include: { roleRef: { select: { permissions: true } } },
  });
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });

  if (target.roleRef?.permissions.includes(ALL_PERMISSIONS)) {
    return Response.json({ error: "لا يمكن حذف حساب المدير" }, { status: 409 });
  }
  if (target.id === session.user.id) {
    return Response.json({ error: "لا يمكنك حذف حسابك" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    // Reset tokens are the other way back in; a pending one must not survive the
    // account it belongs to.
    prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
    prisma.user.delete({ where: { id } }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `حذف حساب موظف: ${target.name}`,
    entity_type: "staff_account",
    entity_id: target.id,
    entity_name: target.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
