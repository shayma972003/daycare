import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Active versus archived counts (task 2.26).
 *
 * The two numbers answer different questions — "how big are we" and "how much
 * history do we hold" — and a single total answers neither. The distinction also
 * matters commercially: plan limits count live records only (see
 * src/lib/plan-limits.ts), so a school near its cap needs to see which of its
 * children are actually counting against it.
 *
 * Note what "archived" means per entity, and why they differ:
 *
 * - **Children and staff** carry `status` + `leftAt` from the retention work, so
 *   archived is `status != ACTIVE`. They deliberately have no `archivedAt`
 *   column — a fourth overlapping flag would eventually disagree with the three
 *   that already exist.
 * - **Classes and units** have a real `archivedAt`, because nothing else on them
 *   expresses "closed but kept".
 *
 * Trashed rows (`deletedAt`) are excluded from both columns everywhere: they are
 * pending deletion, not archive.
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

  const [
    studentsActive,
    studentsArchived,
    studentsAnonymized,
    teachersActive,
    teachersArchived,
    classesActive,
    classesArchived,
    unitsActive,
    unitsArchived,
    trashedStudents,
    trashedTeachers,
    trashedClasses,
  ] = await Promise.all([
    prisma.student.count({ where: { schoolId, deletedAt: null, status: "ACTIVE" } }),
    prisma.student.count({
      where: { schoolId, deletedAt: null, status: { not: "ACTIVE" }, anonymizedAt: null },
    }),
    // Shown separately: these still exist and still count in the statistics, but
    // their personal data is gone and cannot be brought back.
    prisma.student.count({ where: { schoolId, anonymizedAt: { not: null } } }),
    prisma.teacher.count({ where: { schoolId, deletedAt: null, status: "ACTIVE" } }),
    prisma.teacher.count({
      where: { schoolId, deletedAt: null, status: { not: "ACTIVE" }, anonymizedAt: null },
    }),
    prisma.class.count({ where: { schoolId, deletedAt: null, archivedAt: null } }),
    prisma.class.count({ where: { schoolId, deletedAt: null, archivedAt: { not: null } } }),
    prisma.unit.count({ where: { schoolId, deletedAt: null, archivedAt: null } }),
    prisma.unit.count({ where: { schoolId, deletedAt: null, archivedAt: { not: null } } }),
    prisma.student.count({ where: { schoolId, deletedAt: { not: null } } }),
    prisma.teacher.count({ where: { schoolId, deletedAt: { not: null } } }),
    prisma.class.count({ where: { schoolId, deletedAt: { not: null } } }),
  ]);

  return Response.json({
    students: {
      active: studentsActive,
      archived: studentsArchived,
      anonymized: studentsAnonymized,
      trashed: trashedStudents,
    },
    teachers: {
      active: teachersActive,
      archived: teachersArchived,
      trashed: trashedTeachers,
    },
    classes: { active: classesActive, archived: classesArchived, trashed: trashedClasses },
    units: { active: unitsActive, archived: unitsArchived },
  });
}
