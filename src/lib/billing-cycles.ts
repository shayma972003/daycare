/**
 * Billing cycle arithmetic (task 2.37).
 *
 * The product assumed monthly everywhere — `Settings.monthlyStudentFee`, one
 * payment cycle per month — which cannot express a nursery charging by the day
 * for drop-ins or by the year with a discount.
 */

import { astDateOnly, astParts } from "@/lib/datetime";
import type { BillingCycle } from "@/generated/prisma/enums";

export const BILLING_CYCLES: BillingCycle[] = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "CUSTOM",
];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  DAILY: "يومي",
  WEEKLY: "أسبوعي",
  MONTHLY: "شهري",
  YEARLY: "سنوي",
  CUSTOM: "مخصص",
};

/**
 * The nth due date after a start date.
 *
 * Months and years advance by calendar, not by a fixed day count: "monthly from
 * the 15th" means the 15th, not every 30 days, and the two drift apart within
 * the first year.
 *
 * The clamp is what makes 31 January + 1 month land on 28 February rather than
 * on 3 March — the same defect fixed in `payment-cycles.ts` under task 0.22.
 */
export function nthDueDate(
  start: Date,
  cycle: BillingCycle,
  index: number,
  intervalDays?: number | null
): Date {
  const anchor = astDateOnly(start);

  switch (cycle) {
    case "DAILY":
      return addDays(anchor, index);
    case "WEEKLY":
      return addDays(anchor, index * 7);
    case "CUSTOM": {
      // A missing or nonsensical interval falls back to monthly rather than
      // producing a zero-day cycle that would generate infinite due dates.
      const days = intervalDays && intervalDays > 0 ? intervalDays : 0;
      return days > 0 ? addDays(anchor, index * days) : addMonthsClamped(anchor, index);
    }
    case "YEARLY":
      return addMonthsClamped(anchor, index * 12);
    case "MONTHLY":
    default:
      return addMonthsClamped(anchor, index);
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Adds months, clamping to the last day when the target month is shorter.
 *
 * `setUTCMonth` alone rolls over — 31 January + 1 month becomes 3 March — which
 * silently moves a due date into the wrong month.
 */
function addMonthsClamped(date: Date, months: number): Date {
  const { year, month, day } = astParts(date);
  const targetMonth = month + months;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return astDateOnly(
    new Date(Date.UTC(year, targetMonth, Math.min(day, lastDayOfTarget), 12))
  );
}

/**
 * How many cycles fit between two dates, inclusive of the first.
 *
 * Capped by the caller; this returns the honest count so the caller can decide
 * whether it is implausible. A daily enrolment across a year is 365 cycles and
 * that is a real, if unusual, arrangement.
 */
export function cycleCount(
  start: Date,
  end: Date,
  cycle: BillingCycle,
  intervalDays?: number | null,
  max = 400
): number {
  if (end < start) return 0;

  let count = 0;
  while (count < max) {
    const due = nthDueDate(start, cycle, count, intervalDays);
    if (due > astDateOnly(end)) break;
    count++;
  }
  return count;
}

/** Human description, used on the child's profile and the invoice. */
export function describeCycle(
  cycle: BillingCycle,
  intervalDays?: number | null
): string {
  if (cycle === "CUSTOM" && intervalDays && intervalDays > 0) {
    return `كل ${intervalDays} يوماً`;
  }
  return BILLING_CYCLE_LABELS[cycle];
}
