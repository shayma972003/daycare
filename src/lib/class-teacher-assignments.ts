import "server-only";

import type { Prisma } from "@/generated/prisma/client";

type AssignmentClient = Pick<Prisma.TransactionClient, "class" | "classTeacher">;

/**
 * Removes a teacher from every room and keeps the deprecated primary pointer in
 * sync with the remaining assignments. Used by soft delete, permanent delete,
 * and retention cleanup so a deleted account can never retain mobile access.
 */
export async function detachTeacherFromClasses(
  tx: AssignmentClient,
  input: { teacherId: string; schoolId: string }
) {
  const rooms = await tx.class.findMany({
    where: {
      schoolId: input.schoolId,
      OR: [
        { teacherId: input.teacherId },
        { teacherAssignments: { some: { teacherId: input.teacherId, schoolId: input.schoolId } } },
      ],
    },
    select: { id: true, name: true, group: true, deletedAt: true },
  });

  await tx.classTeacher.deleteMany({
    where: { schoolId: input.schoolId, teacherId: input.teacherId },
  });

  for (const room of rooms) {
    const replacement = await tx.classTeacher.findFirst({
      where: { schoolId: input.schoolId, classId: room.id },
      orderBy: [{ createdAt: "asc" }, { teacherId: "asc" }],
      select: { teacherId: true },
    });
    await tx.class.update({
      where: { id: room.id },
      data: {
        teacherId: replacement?.teacherId ?? null,
        needsTeacherWarning: replacement === null,
      },
    });
  }

  return rooms
    .filter((room) => room.deletedAt === null)
    .map((room) => ({ id: room.id, name: room.name, group: room.group }));
}
