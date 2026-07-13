import { prisma } from "@/lib/prisma";

export async function cleanupExpiredTrash() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const expiredStudents = await prisma.student.findMany({
    where: { deletedAt: { lt: thirtyDaysAgo } },
    select: { id: true },
  });
  for (const s of expiredStudents) {
    await prisma.$transaction([
      prisma.attendance.deleteMany({ where: { studentId: s.id } }),
      prisma.invoice.updateMany({ where: { studentId: s.id }, data: { studentId: null } }),
      prisma.student.delete({ where: { id: s.id } }),
    ]);
  }

  const expiredTeachers = await prisma.teacher.findMany({
    where: { deletedAt: { lt: thirtyDaysAgo } },
    select: { id: true },
  });
  for (const teacher of expiredTeachers) {
    await prisma.$transaction([
      prisma.teacherAttendance.deleteMany({ where: { teacherId: teacher.id } }),
      prisma.class.updateMany({ where: { teacherId: teacher.id }, data: { teacherId: null } }),
      prisma.activity.updateMany({ where: { teacherId: teacher.id }, data: { teacherId: null } }),
      prisma.invoice.updateMany({ where: { teacherId: teacher.id }, data: { teacherId: null } }),
      prisma.teacher.delete({ where: { id: teacher.id } }),
    ]);
  }

  const expiredClasses = await prisma.class.findMany({
    where: { deletedAt: { lt: thirtyDaysAgo } },
    select: { id: true },
  });
  for (const c of expiredClasses) {
    await prisma.$transaction([
      prisma.activityInvite.deleteMany({ where: { classId: c.id } }),
      prisma.attendance.updateMany({ where: { classId: c.id }, data: { classId: null } }),
      prisma.student.updateMany({ where: { classId: c.id }, data: { classId: null } }),
      prisma.class.delete({ where: { id: c.id } }),
    ]);
  }

  // Guardians: only delete ones with ZERO Student rows referencing them at all
  // (not just active ones) to avoid FK violations against still-in-window soft-deleted students
  await prisma.guardian.deleteMany({
    where: { deletedAt: { lt: thirtyDaysAgo }, students: { none: {} } },
  });

  console.log("Trash cleanup completed:", new Date().toISOString());
}
