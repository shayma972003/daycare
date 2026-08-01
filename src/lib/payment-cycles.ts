import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";

/** Statuses that represent money already accounted for — never regenerated. */
const SETTLED_STATUSES = ["مدفوع", "ملغي"];

/** Guards against a mistyped end date generating thousands of rows. */
const MAX_CYCLES = 120;

/**
 * Adds one calendar month without the rollover that `setMonth` produces.
 *
 * `new Date(2026, 0, 31).setMonth(1)` lands on 3 March, because 31 February
 * overflows. Repeated month by month that drifts the due day forward and skips
 * February entirely. Clamping to the last valid day keeps the 31st of January
 * billing on 28 February and then back on 31 March.
 */
function addMonthClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const lastDayOfTarget = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month + months,
      Math.min(day, lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes()
    )
  );
}

/**
 * Rebuilds a student's payment schedule.
 *
 * This runs on every student edit, so it must be non-destructive. It previously
 * deleted *all* cycles — including ones already marked paid — and recreated them
 * as pending, which meant changing a phone number wiped the family's payment
 * history and re-billed them for months they had settled. Settled cycles are now
 * left untouched; only unpaid ones are recalculated.
 */
export async function generatePaymentCycles(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      schoolId: true,
      enrollment_date: true,
      enrollmentEndDate: true,
      registration_fee: true,
    },
  });
  if (!student?.enrollment_date || !student.enrollmentEndDate) return;

  const settings = await prisma.settings.findUnique({
    where: { schoolId: student.schoolId },
    select: { monthlyStudentFee: true },
  });

  const monthlyAmount =
    student.registration_fee > 0
      ? student.registration_fee
      : (settings?.monthlyStudentFee ?? 0);
  if (monthlyAmount <= 0) return;

  const start = astDateOnly(student.enrollment_date);
  const end = astDateOnly(student.enrollmentEndDate);
  if (end < start) return;

  const schedule: { due_date: Date; cycle_number: number }[] = [];
  for (let i = 0; i < MAX_CYCLES; i++) {
    const dueDate = addMonthClamped(start, i);
    if (dueDate > end) break;
    schedule.push({ due_date: dueDate, cycle_number: i + 1 });
  }

  const existing = await prisma.paymentCycle.findMany({
    where: { student_id: studentId },
    select: { id: true, cycle_number: true, status: true },
  });

  const settled = new Set(
    existing.filter((c) => SETTLED_STATUSES.includes(c.status)).map((c) => c.cycle_number)
  );
  const removable = existing
    .filter((c) => !SETTLED_STATUSES.includes(c.status))
    .map((c) => c.id);

  const toCreate = schedule
    .filter((c) => !settled.has(c.cycle_number))
    .map((c) => ({
      school_id: student.schoolId,
      student_id: studentId,
      due_date: c.due_date,
      amount: monthlyAmount,
      cycle_number: c.cycle_number,
      status: "بانتظار الدفع",
    }));

  // One transaction: a crash between the delete and the create used to leave the
  // student with no schedule at all.
  await prisma.$transaction([
    prisma.paymentCycle.deleteMany({ where: { id: { in: removable } } }),
    ...(toCreate.length > 0
      ? [prisma.paymentCycle.createMany({ data: toCreate })]
      : []),
  ]);
}
