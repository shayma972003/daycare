import { prisma } from "@/lib/prisma";
import { ROLE_TEMPLATES } from "@/lib/permissions";

/**
 * Gives a school the six starter roles.
 *
 * Called when a school is created and, idempotently, whenever the roles screen
 * is opened — so a tenant restored from an older dump, or created by a code path
 * that forgot to call this, still ends up with a usable set rather than an empty
 * list and no way to make one.
 *
 * `skipDuplicates` on the unique `(schoolId, key)` pair is what makes the repeat
 * call free: existing roles keep whatever the school has since customised, and
 * only genuinely new templates are added. A later release that introduces a
 * seventh role therefore reaches every existing tenant without touching the six
 * they have already tuned.
 */
export async function ensureSchoolRoles(schoolId: string): Promise<void> {
  await prisma.role.createMany({
    data: ROLE_TEMPLATES.map((template) => ({
      schoolId,
      key: template.key,
      nameAr: template.nameAr,
      permissions: template.permissions,
      isSystem: true,
    })),
    skipDuplicates: true,
  });
}

/**
 * The role a school's owner should hold.
 *
 * Used when creating the first user of a new school, and as the repair path when
 * an existing owner somehow has no role.
 */
export async function managerRoleId(schoolId: string): Promise<string | null> {
  const role = await prisma.role.findUnique({
    where: { schoolId_key: { schoolId, key: "manager" } },
    select: { id: true },
  });
  return role?.id ?? null;
}
