import { ALL_PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** Minimal shape shared by cookie sessions and mobile bearer contexts. */
export interface TeacherScopedAccess {
  teacherId: string | null;
  teacherClassIds: string[] | null;
  permissions: readonly string[];
}

/**
 * Returns `null` for an unscoped office/owner account, or the exact active room
 * ids for an account linked to a teacher. Missing scope data fails closed.
 */
export function scopedClassIds(access: TeacherScopedAccess): readonly string[] | null {
  const permissions = access.permissions ?? [];
  if (!access.teacherId || permissions.includes(ALL_PERMISSIONS)) return null;
  return access.teacherClassIds ?? [];
}

export function studentClassWhere(access: TeacherScopedAccess) {
  const classIds = scopedClassIds(access);
  return classIds === null ? {} : { classId: { in: [...classIds] } };
}

export function classIdWhere(access: TeacherScopedAccess) {
  const classIds = scopedClassIds(access);
  return classIds === null ? {} : { id: { in: [...classIds] } };
}

export function mayAccessClass(access: TeacherScopedAccess, classId: string | null | undefined): boolean {
  const classIds = scopedClassIds(access);
  return classIds === null || Boolean(classId && classIds.includes(classId));
}

type StudentLookupClient = Pick<Prisma.TransactionClient, "student">;

/** Direct-id guard for routes whose main operation lives in another helper. */
export async function mayAccessStudent(
  access: TeacherScopedAccess,
  studentId: string,
  schoolId: string,
  db: StudentLookupClient = prisma
): Promise<boolean> {
  const row = await db.student.findFirst({
    where: { id: studentId, schoolId, ...studentClassWhere(access) },
    select: { id: true },
  });
  return Boolean(row);
}
