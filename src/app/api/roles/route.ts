import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { ensureSchoolRoles } from "@/lib/role-seeding";
import { sanitizePermissions, PERMISSIONS, CATEGORY_LABELS } from "@/lib/permissions";
import { z } from "zod";

/**
 * Roles for the current school.
 *
 * The catalogue ships alongside the rows so the permission screen can render
 * every checkbox — including keys added in this release that no role holds yet —
 * without a second request and without duplicating the Arabic labels in the
 * client.
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

  // Idempotent, and the reason a school restored from an old dump is not stuck
  // looking at an empty list with no way to create one.
  await ensureSchoolRoles(schoolId);

  const roles = await prisma.role.findMany({
    where: { schoolId },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      nameAr: true,
      permissions: true,
      isSystem: true,
      _count: { select: { users: true } },
    },
  });

  return Response.json({
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      nameAr: role.nameAr,
      permissions: role.permissions,
      isSystem: role.isSystem,
      userCount: role._count.users,
    })),
    catalogue: PERMISSIONS,
    categoryLabels: CATEGORY_LABELS,
  });
}

const createSchema = z.object({
  nameAr: z.string().min(1).max(60),
  permissions: z.array(z.string()).default([]),
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

  // Unknown keys are dropped rather than rejected. They grant nothing either
  // way, and failing the whole request because an older client sent a key this
  // release removed would be a worse outcome than ignoring it.
  const permissions = sanitizePermissions(parsed.data.permissions);

  // The wildcard is not assignable through the API. A custom role that silently
  // means "everything" is how a permission system stops being one; the owner's
  // role is seeded with it and that is the only place it comes from.
  const role = await prisma.role.create({
    data: {
      schoolId,
      key: `custom_${Date.now().toString(36)}`,
      nameAr: parsed.data.nameAr,
      permissions,
      isSystem: false,
    },
  });

  await logAction({
    school_id: schoolId,
    action: `إنشاء دور صلاحيات: ${role.nameAr}`,
    entity_type: "role",
    entity_id: role.id,
    entity_name: role.nameAr,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(role, { status: 201 });
}
