import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";
import type { PaymentCycleStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { nthDueDate } from "@/lib/billing-cycles";
import type { BillingCycle } from "@/generated/prisma/enums";
import { resolveStudentCycleFee, studentFeeSettingsSelect } from "@/lib/student-cycle-fee";

/** Statuses that represent money already accounted for — never regenerated. */
const SETTLED_STATUSES: PaymentCycleStatus[] = ["PAID", "CANCELLED"];

// A write batch size, NOT a limit on the number of subscription days/cycles.
const WRITE_BATCH_SIZE = 500;

/**
 * Rebuilds a student's payment schedule.
 *
 * Runs on billing edits or renewal, so it must be non-destructive. It previously
 * deleted *all* cycles — including ones already marked paid — and recreated them
 * as pending, which meant changing a phone number wiped the family's payment
 * history and re-billed them for months they had settled. Settled cycles are now
 * left untouched. Renewal only appends; billing edits only recalculate unpaid
 * rows in the current period. Each transaction either completes or rolls back.
 */
type PaymentCycleClient = typeof prisma | Prisma.TransactionClient;

async function generatePaymentCyclesWithClient(studentId: string, client: PaymentCycleClient, renewalStart?: Date) {
  const student = await client.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      schoolId: true,
      enrollment_date: true,
      enrollmentEndDate: true,
      registration_fee: true,
      billingCycle: true,
      billingIntervalDays: true,
      cycleFee: true,
    },
  });
  if (!student?.enrollment_date || !student.enrollmentEndDate) return 0;

  const settings = await client.settings.findUnique({
    where: { schoolId: student.schoolId },
    select: studentFeeSettingsSelect,
  });

  const cycle = (student.billingCycle ?? "MONTHLY") as BillingCycle;
  const cycleAmount = resolveStudentCycleFee(cycle, student.cycleFee, settings);
  // A configured zero is a valid free subscription. Only a missing price skips
  // generation; current subscriptions normally carry their immutable snapshot.
  if (cycleAmount === null) return 0;

  const start = astDateOnly(student.enrollment_date);
  const end = astDateOnly(student.enrollmentEndDate);
  if (end < start) return 0;

  const existing = await client.paymentCycle.findMany({
    where: { student_id: studentId },
    select: { id: true, cycle_number: true, status: true, due_date: true },
  });
  // Renewal only appends. Editing the current period must also keep historical
  // debts and settled rows; cycle_number is not an identity across billing types.
  const preserved = existing.filter((c) => renewalStart || SETTLED_STATUSES.includes(c.status) || c.due_date < start);
  const preservedIds = new Set(preserved.map((c) => c.id));
  const preservedDates = new Set(preserved.map((c) => astDateOnly(c.due_date).getTime()));
  const removable = existing.filter((c) => !preservedIds.has(c.id)).map((c) => c.id);
  let number = existing.reduce((max, c) => Math.max(max, c.cycle_number), 0);
  for (let offset = 0; offset < removable.length; offset += WRITE_BATCH_SIZE) {
    await client.paymentCycle.deleteMany({ where: { id: { in: removable.slice(offset, offset + WRITE_BATCH_SIZE) } } });
  }
  let batch: Prisma.PaymentCycleCreateManyInput[] = [];
  let created = 0;
  for (let i = 0; ; i++) {
    const dueDate = nthDueDate(start, cycle, i, student.billingIntervalDays);
    if (!Number.isFinite(dueDate.getTime())) throw new Error("Invalid payment schedule date");
    if (dueDate > end) break;
    if (renewalStart && dueDate < renewalStart) continue;
    if (preservedDates.has(dueDate.getTime())) continue;
    batch.push({
      school_id: student.schoolId,
      student_id: studentId,
      due_date: dueDate,
      amount: cycleAmount,
      cycle_number: ++number,
      status: "PENDING" as const,
    });
    if (batch.length === WRITE_BATCH_SIZE) {
      created += (await client.paymentCycle.createMany({ data: batch })).count;
      batch = [];
    }
  }
  if (batch.length) created += (await client.paymentCycle.createMany({ data: batch })).count;
  return created;
}

export async function generatePaymentCycles(studentId: string, tx?: Prisma.TransactionClient, renewalStart?: Date) {
  if (tx) return generatePaymentCyclesWithClient(studentId, tx, renewalStart);
  return prisma.$transaction((transaction) => generatePaymentCyclesWithClient(studentId, transaction), { timeout: 30_000 });
}

/** Marks only installments that are already due; future months remain pending. */
export async function markDuePaymentCyclesPaid(input: {
  studentId: string;
  schoolId: string;
  actor: string;
  at?: Date;
}, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const paidAt = input.at ?? new Date();
  return client.paymentCycle.updateMany({
    where: {
      student_id: input.studentId,
      school_id: input.schoolId,
      due_date: { lte: astDateOnly(paidAt) },
      status: { notIn: ["PAID", "CANCELLED"] },
    },
    data: { status: "PAID", paid_at: paidAt, paid_by: input.actor },
  });
}
