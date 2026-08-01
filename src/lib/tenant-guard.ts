import { prisma } from "@/lib/prisma";

/**
 * Ownership checks for foreign keys that arrive from the client.
 *
 * Filtering the *target* row by schoolId is not enough on its own: routes also
 * accept `guardianId`, `classId` and `teacherId` in the request body and wrote
 * them straight through. Nothing stopped a caller pointing their own student at
 * another school's guardian — and because the read paths `include` those
 * relations, the next GET handed back the other tenant's record. Every such id
 * must be proven to belong to the caller's school before it is written.
 */

export class CrossTenantError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "CrossTenantError";
  }
}

/** Resolves a client-supplied class id, or throws if it is not this school's. */
export async function assertClassOwned(
  classId: string | null | undefined,
  schoolId: string
): Promise<string | null> {
  if (!classId) return null;

  const found = await prisma.class.findFirst({
    where: { id: classId, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!found) throw new CrossTenantError("classId", "الفصل غير موجود");

  return found.id;
}

export async function assertGuardianOwned(
  guardianId: string | null | undefined,
  schoolId: string
): Promise<string | null> {
  if (!guardianId) return null;

  const found = await prisma.guardian.findFirst({
    where: { id: guardianId, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!found) throw new CrossTenantError("guardianId", "ولي الأمر غير موجود");

  return found.id;
}

export async function assertTeacherOwned(
  teacherId: string | null | undefined,
  schoolId: string
): Promise<string | null> {
  if (!teacherId) return null;

  const found = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!found) throw new CrossTenantError("teacherId", "المعلم غير موجود");

  return found.id;
}

export async function assertStudentOwned(
  studentId: string | null | undefined,
  schoolId: string
): Promise<string | null> {
  if (!studentId) return null;

  const found = await prisma.student.findFirst({
    where: { id: studentId, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!found) throw new CrossTenantError("studentId", "الطفل غير موجود");

  return found.id;
}

/**
 * Turns a CrossTenantError into a 404 — deliberately not a 403, which would
 * confirm the id exists somewhere else in the system.
 */
export function crossTenantResponse(error: unknown): Response | null {
  if (error instanceof CrossTenantError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  return null;
}
