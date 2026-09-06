import "server-only";

import { Prisma } from "@/generated/prisma/client";

type ActivityLockClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/**
 * The first database operation in every activity target mutation.
 *
 * A tenant-scoped row lock gives updates and message snapshots one ordering:
 * whichever request locks Activity first owns the authoritative content and
 * ActivityInvite/teacher target until its transaction commits.
 */
export async function lockActivityForUpdate(
  tx: ActivityLockClient,
  input: { id: string; schoolId: string }
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Activity"
    WHERE "id" = ${input.id} AND "schoolId" = ${input.schoolId}
    FOR UPDATE
  `);
  return rows.length === 1;
}

/** Locks all activity rows whose class target will be removed, in one order. */
export async function lockActivitiesForClassTargetChange(
  tx: ActivityLockClient,
  input: { classId: string; schoolId: string }
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT activity."id"
    FROM "Activity" AS activity
    INNER JOIN "ActivityInvite" AS invite
      ON invite."activityId" = activity."id"
    WHERE invite."classId" = ${input.classId}
      AND activity."schoolId" = ${input.schoolId}
    ORDER BY activity."id"
    FOR UPDATE OF activity
  `);
  return rows.map((row) => row.id);
}

/** Locks all activity rows whose responsible teacher will be cleared. */
export async function lockActivitiesForTeacherTargetChange(
  tx: ActivityLockClient,
  input: { teacherId: string; schoolId: string }
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Activity"
    WHERE "teacherId" = ${input.teacherId}
      AND "schoolId" = ${input.schoolId}
    ORDER BY "id"
    FOR UPDATE
  `);
  return rows.map((row) => row.id);
}

/**
 * Removing a class/teacher target must also invalidate an editor's old
 * `updatedAt`. `GREATEST` makes the timestamp strictly newer even if both
 * writes happen inside the database timestamp's millisecond precision.
 */
export async function touchActivityTargetRevisions(
  tx: ActivityLockClient,
  input: { activityIds: string[]; schoolId: string }
): Promise<void> {
  if (input.activityIds.length === 0) return;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Activity"
    SET "updatedAt" = GREATEST(CURRENT_TIMESTAMP, "updatedAt" + INTERVAL '1 millisecond')
    WHERE "schoolId" = ${input.schoolId}
      AND "id" IN (${Prisma.join(input.activityIds)})
  `);
}
