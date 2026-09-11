import { prisma } from "@/lib/prisma";
import { logSafeError } from "@/lib/safe-logger";
import {
  lockActivitiesForClassTargetChange,
  lockActivitiesForTeacherTargetChange,
  touchActivityTargetRevisions,
} from "@/lib/activity-lock";

const RETENTION_DAYS = 30;

/** Bounded per run so one nightly invocation cannot exceed the function timeout. */
const BATCH_SIZE = 200;

export interface TrashCleanupResult {
  students: number;
  teachers: number;
  classes: number;
  guardians: number;
  failures: number;
}

/**
 * Permanently removes records that have sat in the trash past the retention
 * window.
 *
 * Two defects made this job a no-op in production. It never handled
 * `PaymentCycle`, which holds a non-nullable FK to Student with no cascade, so
 * `student.delete` threw for any student who had ever been billed — which is
 * essentially all of them. And with no per-record error handling, that first
 * throw aborted the whole run, so teachers, classes and guardians were never
 * purged either. Each record is now isolated: one bad row is logged and skipped
 * instead of killing the job.
 */
export async function cleanupExpiredTrash(): Promise<TrashCleanupResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result: TrashCleanupResult = {
    students: 0,
    teachers: 0,
    classes: 0,
    guardians: 0,
    failures: 0,
  };

  const expiredStudents = await prisma.student.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
    take: BATCH_SIZE,
  });

  for (const student of expiredStudents) {
    try {
      await prisma.$transaction([
        prisma.attendance.deleteMany({ where: { studentId: student.id } }),
        // The missing piece: a hard FK with no cascade.
        prisma.paymentCycle.deleteMany({ where: { student_id: student.id } }),
        prisma.enrollmentSubmission.updateMany({
          where: { student_id: student.id },
          data: { student_id: null },
        }),
        prisma.invoice.updateMany({
          where: { studentId: student.id },
          data: { studentId: null },
        }),
        prisma.student.delete({ where: { id: student.id } }),
      ]);
      result.students++;
    } catch (error) {
      result.failures++;
      logSafeError("trash-cleanup-student", error);
    }
  }

  const expiredTeachers = await prisma.teacher.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, schoolId: true },
    take: BATCH_SIZE,
  });

  for (const teacher of expiredTeachers) {
    try {
      await prisma.$transaction(async (tx) => {
        const activityIds = await lockActivitiesForTeacherTargetChange(tx, {
          teacherId: teacher.id,
          schoolId: teacher.schoolId,
        });
        await tx.teacherAttendance.deleteMany({ where: { teacherId: teacher.id } });
        await tx.user.updateMany({
          where: { teacherId: teacher.id, schoolId: teacher.schoolId },
          data: { teacherId: null },
        });
        await tx.class.updateMany({
          where: { teacherId: teacher.id },
          data: { teacherId: null },
        });
        await tx.activity.updateMany({
          where: { teacherId: teacher.id },
          data: { teacherId: null },
        });
        await touchActivityTargetRevisions(tx, {
          activityIds,
          schoolId: teacher.schoolId,
        });
        await tx.invoice.updateMany({
          where: { teacherId: teacher.id },
          data: { teacherId: null },
        });
        await tx.teacher.delete({ where: { id: teacher.id } });
      });
      result.teachers++;
    } catch (error) {
      result.failures++;
      logSafeError("trash-cleanup-teacher", error);
    }
  }

  const expiredClasses = await prisma.class.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, schoolId: true },
    take: BATCH_SIZE,
  });

  for (const cls of expiredClasses) {
    try {
      await prisma.$transaction(async (tx) => {
        const activityIds = await lockActivitiesForClassTargetChange(tx, {
          classId: cls.id,
          schoolId: cls.schoolId,
        });
        await tx.activityInvite.deleteMany({ where: { classId: cls.id } });
        await touchActivityTargetRevisions(tx, {
          activityIds,
          schoolId: cls.schoolId,
        });
        await tx.attendance.updateMany({
          where: { classId: cls.id },
          data: { classId: null },
        });
        await tx.student.updateMany({
          where: { classId: cls.id },
          data: { classId: null },
        });
        await tx.class.delete({ where: { id: cls.id } });
      });
      result.classes++;
    } catch (error) {
      result.failures++;
      logSafeError("trash-cleanup-class", error);
    }
  }

  // Only guardians with no Student rows at all — including soft-deleted ones
  // still inside the retention window, which would otherwise raise an FK error.
  try {
    const { count } = await prisma.guardian.deleteMany({
      where: { deletedAt: { lt: cutoff }, students: { none: {} } },
    });
    result.guardians = count;
  } catch (error) {
    result.failures++;
    logSafeError("trash-cleanup-guardian", error);
  }

  console.log("[trash-cleanup] done:", result);
  return result;
}
