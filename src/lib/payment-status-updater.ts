import { prisma } from "@/lib/prisma";
import { PaymentCycleStatus, PaymentStatus } from "@/generated/prisma/enums";
import { astDayStart } from "@/lib/datetime";
import { Prisma } from "@/generated/prisma/client";

/** Days past due at which a cycle moves to the next state. */
const LATE_AFTER_DAYS = 4;
const SUSPENDED_AFTER_DAYS = 8;

/** How a cycle's state rolls up onto the student. */
const CYCLE_TO_STUDENT: Record<PaymentCycleStatus, PaymentStatus> = {
  PAID: "PAID",
  PENDING: "PENDING",
  OVERDUE: "LATE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
};

/** Worst status among a student's cycles wins. */
const STATUS_PRIORITY: PaymentCycleStatus[] = ["SUSPENDED", "OVERDUE", "PENDING", "PAID"];

export async function updatePaymentStatuses(school_id: string) {
  const now = new Date();
  // Business day in AST. Was host-local, so on a UTC server the day boundary
  // moved and students were suspended a day early or late.
  const today = astDayStart(now);

  const cycles = await prisma.paymentCycle.findMany({
    where: { school_id, status: { in: ["PENDING", "OVERDUE"] } },
    include: { student: { select: { id: true, suspension_notified_at: true, enrollment_date: true } } },
  });

  const suspendedStudents: string[] = [];
  const touchedStudentIds = new Set<string>();

  for (const cycle of cycles) {
    const daysPastDue = Math.floor(
      (today.getTime() - cycle.due_date.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysPastDue < 1) continue;

    let newStatus: PaymentCycleStatus = cycle.status;
    if (daysPastDue >= SUSPENDED_AFTER_DAYS) {
      newStatus = "SUSPENDED";
      if (!cycle.student.suspension_notified_at && (!cycle.student.enrollment_date || cycle.due_date >= cycle.student.enrollment_date)) suspendedStudents.push(cycle.student_id);
    } else if (daysPastDue >= LATE_AFTER_DAYS) {
      newStatus = "OVERDUE";
    } else {
      newStatus = "PENDING";
    }

    if (newStatus !== cycle.status) {
      await prisma.paymentCycle.update({
        where: { id: cycle.id },
        data: { status: newStatus },
      });
      touchedStudentIds.add(cycle.student_id);
    }
  }

  for (const studentId of touchedStudentIds) {
    await updateStudentPaymentStatus(studentId);
  }

  if (suspendedStudents.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: suspendedStudents } },
      // Status is updated under the same student lock used by renewal below.
      data: { suspension_notified_at: now },
    });
  }

  return { suspendedStudents };
}

async function updateStudentPaymentStatus(studentId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`);
    const student = await tx.student.findUnique({ where: { id: studentId }, select: { isActive: true, deletedAt: true, paymentStatus: true, enrollment_date: true, enrollmentEndDate: true } });
    if (!student || !student.isActive || student.deletedAt || student.paymentStatus === "CANCELLED") return;
    // Previous-period debts remain on their cycles, but cannot suspend a newly
    // renewed period when the statistics screen refreshes its status rollup.
    const cycles = await tx.paymentCycle.findMany({
      where: { student_id: studentId, due_date: {
        ...(student.enrollment_date ? { gte: student.enrollment_date } : {}),
        ...(student.enrollmentEndDate ? { lte: student.enrollmentEndDate } : {}),
      } }, select: { status: true },
    });
    for (const status of STATUS_PRIORITY) {
      if (cycles.some((c) => c.status === status)) {
        await tx.student.update({ where: { id: studentId }, data: { paymentStatus: CYCLE_TO_STUDENT[status] } });
        return;
      }
    }
  });
}
