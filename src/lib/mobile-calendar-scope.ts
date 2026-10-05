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

/**
 * Calendar audience visible to a staff account linked to a teacher.
 *
 * A null-teacher event is not automatically public: it may still target a
 * different room. Public means both targeting dimensions are empty.
 */
export function staffCalendarAudience(classIds: string[], teacherId: string | null) {
  return {
    OR: [
      ...(classIds.length > 0
        ? [{ classes: { some: { classId: { in: classIds } } } }]
        : []),
      ...(teacherId ? [{ teacherId }] : []),
      { teacherId: null, classes: { none: {} } },
    ],
  };
}

/** Same audience rules for programmes, whose room relation is ActivityInvite. */
export function guardianProgrammeAudience(classIds: string[], teacherIds: string[]) {
  return {
    OR: [
      ...(classIds.length > 0
        ? [{ activityInvites: { some: { classId: { in: classIds } } } }]
        : []),
      ...(teacherIds.length > 0
        ? [{ teacherId: { in: teacherIds } }]
        : []),
      { teacherId: null, activityInvites: { none: {} } },
    ],
  };
}

export function staffProgrammeAudience(classIds: string[], teacherId: string | null) {
  return {
    OR: [
      ...(classIds.length > 0
        ? [{ activityInvites: { some: { classId: { in: classIds } } } }]
        : []),
      ...(teacherId ? [{ teacherId }] : []),
      { teacherId: null, activityInvites: { none: {} } },
    ],
  };
}
