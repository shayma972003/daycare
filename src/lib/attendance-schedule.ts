/**
 * Age bands, class capacity and per-child attendance days (tasks 2.9–2.13).
 */

import type { AgeGroup, AttendanceStatus } from "@/generated/prisma/enums";
import { astParts } from "@/lib/datetime";

export const AGE_GROUPS: AgeGroup[] = [
  "AGE_0_6M",
  "AGE_6_12M",
  "AGE_1_2Y",
  "AGE_2_3Y",
  "AGE_3_4Y",
];

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  AGE_0_6M: "0-6 شهور",
  AGE_6_12M: "6 شهور - سنة",
  AGE_1_2Y: "سنة - سنتين",
  AGE_2_3Y: "سنتان - 3 سنوات",
  AGE_3_4Y: "3 - 4 سنوات",
};

/** Upper bound of each band in months, used to place a child by date of birth. */
const AGE_GROUP_MAX_MONTHS: Record<AgeGroup, number> = {
  AGE_0_6M: 6,
  AGE_6_12M: 12,
  AGE_1_2Y: 24,
  AGE_2_3Y: 36,
  AGE_3_4Y: 48,
};

/**
 * The band a child of this age falls into, or null when they are older than the
 * top band.
 *
 * Returning null rather than clamping to the oldest band: a five-year-old in a
 * nursery is a fact worth surfacing, not one to round away.
 */
export function ageGroupForMonths(months: number): AgeGroup | null {
  for (const group of AGE_GROUPS) {
    if (months < AGE_GROUP_MAX_MONTHS[group]) return group;
  }
  return null;
}

export function monthsOld(dateOfBirth: Date, at: Date = new Date()): number {
  const born = astParts(dateOfBirth);
  const now = astParts(at);
  let months = (now.year - born.year) * 12 + (now.month - born.month);
  if (now.day < born.day) months -= 1;
  return Math.max(0, months);
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "حاضر",
  ABSENT: "غائب",
  LEAVE: "إجازة",
  CHECKED_OUT: "منصرف",
  NO_RECORD: "لا يوجد سجل",
};

/** Tailwind classes per state, so the colour vocabulary is defined once. */
export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  PRESENT: "text-emerald-600",
  ABSENT: "text-red-500",
  LEAVE: "text-amber-500",
  CHECKED_OUT: "text-gray-500",
  NO_RECORD: "text-gray-300",
};

/**
 * Weekday names, indexed to match `Date.getUTCDay()`.
 *
 * The Saudi working week runs Sunday to Thursday, so the array starts at Sunday
 * and the default schedule below is 0–4.
 */
export const WEEKDAY_LABELS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/** Sunday–Thursday. */
export const DEFAULT_ATTENDANCE_DAYS = [0, 1, 2, 3, 4];

/**
 * The days a child is expected, treating an empty list as the default week.
 *
 * Empty is the state every existing row starts in, and it has to mean "the
 * normal week" rather than "never expected" — otherwise this feature would
 * silently mark the entire school as not-expected until someone edited every
 * child.
 */
export function expectedDays(attendanceDays: number[]): number[] {
  return attendanceDays.length > 0 ? attendanceDays : DEFAULT_ATTENDANCE_DAYS;
}

export function isExpectedOn(attendanceDays: number[], date: Date): boolean {
  const { year, month, day } = astParts(date);
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return expectedDays(attendanceDays).includes(weekday);
}

/**
 * "3/5 أيام" for one child over a range (task 2.13).
 *
 * The denominator is days the child was *expected*, not days the nursery was
 * open. A child enrolled three days a week has not missed anything by being
 * absent on the other two, and counting it against them makes the figure
 * meaningless for exactly the families this feature is for.
 */
export function attendanceRatio(
  attendanceDays: number[],
  presentDates: Date[],
  from: Date,
  to: Date
): { attended: number; expected: number } {
  const days = expectedDays(attendanceDays);
  let expected = 0;

  const cursor = new Date(
    Date.UTC(astParts(from).year, astParts(from).month, astParts(from).day)
  );
  const end = new Date(Date.UTC(astParts(to).year, astParts(to).month, astParts(to).day));

  while (cursor <= end) {
    if (days.includes(cursor.getUTCDay())) expected++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const attendedKeys = new Set(
    presentDates.map((date) => {
      const parts = astParts(date);
      return `${parts.year}-${parts.month}-${parts.day}`;
    })
  );

  return { attended: attendedKeys.size, expected };
}

export interface CapacityState {
  count: number;
  capacity: number | null;
  /** True only when a limit is set and exceeded. */
  over: boolean;
  remaining: number | null;
}

/**
 * Capacity for one room (task 2.10).
 *
 * A null capacity is "not configured" and never warns. Turning an unset field
 * into an implicit limit would light up warnings across a school that never
 * asked for them, and the warnings would be ignored from that day on.
 */
export function capacityState(count: number, capacity: number | null): CapacityState {
  if (capacity === null || capacity === undefined) {
    return { count, capacity: null, over: false, remaining: null };
  }
  return {
    count,
    capacity,
    over: count > capacity,
    remaining: capacity - count,
  };
}
