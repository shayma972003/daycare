import { prisma } from "@/lib/prisma";
import { enqueuePush } from "@/lib/push";
import { logSafeError } from "@/lib/safe-logger";

export type StudentAttendanceEvent = "checkin" | "checkout";

/** Queues a private push for every active guardian account linked to the child. */
export async function notifyGuardiansOfAttendance(input: {
  schoolId: string;
  studentId: string;
  studentName: string;
  event: StudentAttendanceEvent;
}): Promise<number> {
  const student = await prisma.student.findFirst({
    where: {
      id: input.studentId,
      schoolId: input.schoolId,
      deletedAt: null,
      anonymizedAt: null,
    },
    select: {
      guardianId: true,
      guardianLinks: { select: { guardianId: true } },
    },
  });
  if (!student) return 0;

  const guardianIds = new Set<string>();
  if (student.guardianId) guardianIds.add(student.guardianId);
  for (const link of student.guardianLinks) guardianIds.add(link.guardianId);
  if (guardianIds.size === 0) return 0;

  const accounts = await prisma.guardianAccount.findMany({
    where: {
      schoolId: input.schoolId,
      guardianId: { in: [...guardianIds] },
      acceptedAt: { not: null },
      disabledAt: null,
      notifyAttendance: true,
      guardian: { is: { deletedAt: null, anonymizedAt: null } },
    },
    select: { id: true },
  });

  const body = input.event === "checkin"
    ? `تم تسجيل دخول ${input.studentName}.`
    : `تم تسجيل خروج ${input.studentName}.`;
  let queued = 0;
  for (const account of accounts) {
    try {
      queued += await enqueuePush(
        { schoolId: input.schoolId, guardianAccountId: account.id },
        {
          title: "الحضور",
          body,
          data: {
            screen: "attendance",
            kind: `student_${input.event}`,
            studentId: input.studentId,
          },
        }
      );
    } catch (error) {
      logSafeError("attendance-guardian-push", error);
    }
  }
  return queued;
}
