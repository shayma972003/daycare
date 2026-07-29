import { prisma } from "@/lib/prisma";

const CYCLE_TO_STUDENT_STATUS: Record<string, string> = {
  "مدفوع": "PAID",
  "متأخر": "LATE",
  "موقف": "SUSPENDED",
  "بانتظار الدفع": "بانتظار الدفع",
};

// Priority order — the worst status among a student's cycles wins.
const STATUS_PRIORITY = ["موقف", "متأخر", "بانتظار الدفع", "مدفوع"];

export async function updatePaymentStatuses(school_id: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const cycles = await prisma.paymentCycle.findMany({
    where: {
      school_id,
      status: { in: ["بانتظار الدفع", "متأخر"] },
    },
    include: { student: true },
  });

  const suspendedStudents: string[] = [];
  const touchedStudentIds = new Set<string>();

  for (const cycle of cycles) {
    const dueDate = new Date(cycle.due_date);
    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPastDue < 0) continue;

    let newStatus = cycle.status;

    if (daysPastDue >= 1 && daysPastDue <= 3) {
      newStatus = "بانتظار الدفع";
    } else if (daysPastDue >= 4 && daysPastDue <= 7) {
      newStatus = "متأخر";
    } else if (daysPastDue >= 8) {
      newStatus = "موقف";
      if (!cycle.student.suspension_notified_at) {
        suspendedStudents.push(cycle.student_id);
      }
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
      data: {
        paymentStatus: "SUSPENDED",
        suspension_notified_at: now,
      },
    });
  }

  return { suspendedStudents };
}

async function updateStudentPaymentStatus(studentId: string) {
  const cycles = await prisma.paymentCycle.findMany({
    where: { student_id: studentId },
    orderBy: { due_date: "desc" },
  });

  for (const status of STATUS_PRIORITY) {
    if (cycles.some((c) => c.status === status)) {
      await prisma.student.update({
        where: { id: studentId },
        data: { paymentStatus: CYCLE_TO_STUDENT_STATUS[status] ?? status },
      });
      return;
    }
  }
}
