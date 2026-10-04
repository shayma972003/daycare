/**
 * Calendar audience visible to a guardian.
 *
 * An event is visible when it targets at least one of the guardian's children's
 * classes, targets a teacher assigned to one of those classes, or is fully
 * public (no class and no teacher). Keeping this predicate in one place makes
 * it harder for a future UI change to accidentally widen the API response.
 */
export function guardianCalendarAudience(classIds: string[], teacherIds: string[]) {
  return {
    OR: [
      ...(classIds.length > 0
        ? [{ classes: { some: { classId: { in: classIds } } } }]
        : []),
      ...(teacherIds.length > 0
        ? [{ teacherId: { in: teacherIds } }]
        : []),
      { teacherId: null, classes: { none: {} } },
    ],
  };
}
