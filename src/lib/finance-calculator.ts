/**
 * Counts how many monthly payment occurrences fall inside a reporting period.
 *
 * A monthly payment occurs on the same day-of-month as the start date,
 * every month from start_date through end_date (inclusive).
 *
 * We only count occurrences where the payment month falls inside [periodFrom, periodTo].
 */
export function countMonthsInPeriod(
  startDate: Date,
  endDate: Date,
  periodFrom: Date,
  periodTo: Date
): number {
  // Normalize all dates to first-of-month for comparison
  const contractStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const contractEnd = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  const reportStart = new Date(periodFrom.getFullYear(), periodFrom.getMonth(), 1);
  const reportEnd = new Date(periodTo.getFullYear(), periodTo.getMonth(), 1);

  // The overlap is the intersection of [contractStart, contractEnd] and [reportStart, reportEnd]
  const overlapStart = contractStart > reportStart ? contractStart : reportStart;
  const overlapEnd = contractEnd < reportEnd ? contractEnd : reportEnd;

  // No overlap
  if (overlapStart > overlapEnd) return 0;

  // Count months in the overlap (inclusive on both ends)
  const months =
    (overlapEnd.getFullYear() - overlapStart.getFullYear()) * 12 +
    (overlapEnd.getMonth() - overlapStart.getMonth()) +
    1; // +1 because both start and end months are included

  return Math.max(0, months);
}

/**
 * Calculates the amount owed for a recurring monthly item within a reporting period.
 */
export function calculateRecurringAmount(
  monthlyAmount: number,
  startDate: Date,
  endDate: Date,
  periodFrom: Date,
  periodTo: Date
): number {
  const months = countMonthsInPeriod(startDate, endDate, periodFrom, periodTo);
  return monthlyAmount * months;
}
