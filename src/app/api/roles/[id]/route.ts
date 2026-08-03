import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sanitizePermissions, ALL_PERMISSIONS } from "@/lib/permissions";
import { z } from "zod";

const updateSchema = z.object({
  nameAr: z.string().min(1).max(60).optional(),
  permissions: z.array(z.string()).optional(),
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

  const existing = await prisma.role.findFirst({ where: { id, schoolId } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  /**
   * The owner's role is not editable.
   *
   * Whoever is editing holds it — that is what let them reach this route — so
   * an accidental save with half the boxes unticked would lock the school out of
   * its own settings, with nobody left holding the permission needed to undo it.
   */
  if (existing.permissions.includes(ALL_PERMISSIONS)) {
    return Response.json(
      { error: "لا يمكن تعديل صلاحيات دور المدير" },
      { status: 409 }
    );
  }

  const data: { nameAr?: string; permissions?: string[] } = {};
  if (parsed.data.nameAr !== undefined) data.nameAr = parsed.data.nameAr;
  if (parsed.data.permissions !== undefined) {
    // Escalation guard: the wildcard cannot be granted through this route, so a
    // manager cannot mint a second all-powerful role.
    data.permissions = sanitizePermissions(parsed.data.permissions).filter(
      (key) => key !== ALL_PERMISSIONS
    );
  }

  const role = await prisma.role.update({ where: { id }, data });

  await logAction({
    school_id: schoolId,
    action: `تعديل صلاحيات الدور: ${role.nameAr}`,
    entity_type: "role",
    entity_id: role.id,
    entity_name: role.nameAr,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(role);
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

  const existing = await prisma.role.findFirst({
    where: { id, schoolId },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  // Seeded roles stay. Deleting "مدير" would leave a school with no route back
  // into its own settings.
  if (existing.isSystem) {
    return Response.json(
      { error: "لا يمكن حذف الأدوار الأساسية" },
      { status: 409 }
    );
  }

  // Refused rather than cascading to null: a user silently left with no role
  // loses access to everything, and the cause would be invisible.
  if (existing._count.users > 0) {
    return Response.json(
      {
        error: `الدور مُسنَد إلى ${existing._count.users} موظف — انقلهم إلى دور آخر أولاً`,
        userCount: existing._count.users,
      },
      { status: 409 }
    );
  }

  await prisma.role.delete({ where: { id } });

  await logAction({
    school_id: schoolId,
    action: `حذف دور صلاحيات: ${existing.nameAr}`,
    entity_type: "role",
    entity_id: existing.id,
    entity_name: existing.nameAr,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
