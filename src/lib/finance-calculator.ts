import { astParts } from "@/lib/datetime";

/**
 * Counts how many monthly payment occurrences fall inside a reporting period.
 *
 * A monthly payment occurs on the same day-of-month as the start date, every
 * month from start_date through end_date (inclusive). Only occurrences whose
 * month falls inside [periodFrom, periodTo] are counted.
 *
 * The month components are read in AST, and that is the entire fix here. The
 * period boundaries come from `getPeriodRange`, which builds AST-anchored
 * instants: July 2026 starts at 2026-06-30T21:00Z. Reading `getFullYear()` and
 * `getMonth()` off that instant on a UTC host — which is what Vercel runs —
 * returned **June**, while the period end returned July. The intersection
 * spanned two months instead of one, so every student fee and every teacher
 * salary was multiplied by two. Every monthly report was double.
 */
export function countMonthsInPeriod(
  startDate: Date,
  endDate: Date,
  periodFrom: Date,
  periodTo: Date
): number {
  const contract = { start: monthIndex(startDate), end: monthIndex(endDate) };
  const report = { start: monthIndex(periodFrom), end: monthIndex(periodTo) };

  const overlapStart = Math.max(contract.start, report.start);
  const overlapEnd = Math.min(contract.end, report.end);

  if (overlapStart > overlapEnd) return 0;

  // Inclusive on both ends.
  return overlapEnd - overlapStart + 1;
}

/**
 * Absolute month number (year * 12 + month) in AST.
 *
 * Comparing a single integer avoids the class of bug above entirely: there is
 * no intermediate Date whose components could be read in the wrong zone.
 */
function monthIndex(date: Date): number {
  const { year, month } = astParts(date);
  return year * 12 + month;
}

/**
 * Amount owed for a recurring monthly item within a reporting period.
 */
export function calculateRecurringAmount(
  monthlyAmount: number,
  startDate: Date,
  endDate: Date,
  periodFrom: Date,
  periodTo: Date
): number {
  return monthlyAmount * countMonthsInPeriod(startDate, endDate, periodFrom, periodTo);
}
