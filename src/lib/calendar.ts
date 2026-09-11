import type { CalendarEventType } from "@/generated/prisma/enums";
import {
  addDateDays,
  dateKeyInTimeZone,
  deviceTimeZone,
  storedDate,
  zonedTimeOnDate,
} from "@/lib/device-date";

export type CalendarView = "day" | "week" | "month";

export const CALENDAR_VIEW_LABEL_KEYS: Record<CalendarView, string> = {
  day: "calendarView.day",
  week: "calendarView.week",
  month: "calendarView.month",
};

export const EVENT_TYPE_LABEL_KEYS: Record<CalendarEventType, string> = {
  LESSON: "calendar.typeLESSON",
  ACTIVITY: "calendar.typeACTIVITY",
  ANNOUNCEMENT: "calendar.typeANNOUNCEMENT",
  UNIT: "calendar.typeUNIT",
};

export const EVENT_TYPE_STYLES: Record<CalendarEventType, string> = {
  LESSON: "bg-[#F1E8FF] border-[#5B14D1] text-[#4A168C]",
  ACTIVITY: "bg-[#FFF1E6] border-[#F8B500] text-[#8a5a00]",
  ANNOUNCEMENT: "bg-[#F1E8FF] border-[#5B14D1] text-[#8f1f27]",
  UNIT: "bg-[#F3EEFF] border-[#7C3AED] text-[#4c1d95]",
};

export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 23;

/** Retained for compatibility with older reports; the calendar now draws once. */
export function hoursOccupied(
  startHour: number,
  _startMinute: number,
  endHour: number | null,
  endMinute: number | null
): number[] {
  const last = endHour === null
    ? DAY_END_HOUR
    : endMinute === 0 && endHour > startHour
      ? endHour - 1
      : endHour;
  const hours: number[] = [];
  for (let hour = startHour; hour <= Math.min(last, DAY_END_HOUR); hour++) hours.push(hour);
  return hours.length > 0 ? hours : [startHour];
}

/** Legacy Riyadh-era helper retained only for backwards-compatible tests. */
export function coversDay(start: Date, end: Date | null, day: Date): boolean {
  const key = (value: Date) => {
    const shifted = new Date(value.getTime() + 3 * 60 * 60 * 1000);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  };
  const startDay = key(start);
  const target = key(day);
  if (startDay === target) return true;
  return Boolean(end && startDay < target && target <= key(end));
}

export function hourLabel(hour: number, locale: "ar" | "en" = "ar"): string {
  const suffix = hour < 12 ? (locale === "en" ? "am" : "ص") : locale === "en" ? "pm" : "م";
  return `${hour % 12 === 0 ? 12 : hour % 12}:00 ${suffix}`;
}

export interface CalendarRange {
  from: Date;
  to: Date;
  days: Date[];
}

function dayInstant(date: string, timeZone: string): Date {
  return zonedTimeOnDate(date, "00:00", timeZone) ?? storedDate(date);
}

function monthShift(date: string, months: number): string {
  const parsed = storedDate(date);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

export function rangeFor(
  view: CalendarView,
  anchor: Date,
  timeZone: string = deviceTimeZone()
): CalendarRange {
  const anchorKey = dateKeyInTimeZone(anchor, timeZone);
  if (view === "day") {
    return {
      from: dayInstant(anchorKey, timeZone),
      to: dayInstant(addDateDays(anchorKey, 1), timeZone),
      days: [dayInstant(anchorKey, timeZone)],
    };
  }
  if (view === "week") {
    const fromKey = addDateDays(anchorKey, -storedDate(anchorKey).getUTCDay());
    const days = Array.from({ length: 7 }, (_, index) =>
      dayInstant(addDateDays(fromKey, index), timeZone)
    );
    return { from: days[0], to: dayInstant(addDateDays(fromKey, 7), timeZone), days };
  }
  const firstKey = `${anchorKey.slice(0, 7)}-01`;
  const fromKey = addDateDays(firstKey, -storedDate(firstKey).getUTCDay());
  const nextMonthKey = monthShift(firstKey, 1);
  const nextWeekday = storedDate(nextMonthKey).getUTCDay();
  const toKey = addDateDays(nextMonthKey, nextWeekday === 0 ? 0 : 7 - nextWeekday);
  const days: Date[] = [];
  for (let key = fromKey; key < toKey; key = addDateDays(key, 1)) {
    days.push(dayInstant(key, timeZone));
  }
  return { from: days[0], to: dayInstant(toKey, timeZone), days };
}

export function shiftAnchor(
  view: CalendarView,
  anchor: Date,
  direction: 1 | -1,
  timeZone: string = deviceTimeZone()
): Date {
  const key = dateKeyInTimeZone(anchor, timeZone);
  if (view === "day") return dayInstant(addDateDays(key, direction), timeZone);
  if (view === "week") return dayInstant(addDateDays(key, direction * 7), timeZone);
  return dayInstant(monthShift(key, direction), timeZone);
}

export function isSameCalendarDay(a: Date, b: Date, timeZone = deviceTimeZone()): boolean {
  return dateKeyInTimeZone(a, timeZone) === dateKeyInTimeZone(b, timeZone);
}

export function isSameCalendarMonth(a: Date, b: Date, timeZone = deviceTimeZone()): boolean {
  return dateKeyInTimeZone(a, timeZone).slice(0, 7) === dateKeyInTimeZone(b, timeZone).slice(0, 7);
}

export const isSameAstDay = isSameCalendarDay;
export const isSameAstMonth = isSameCalendarMonth;

export type CalendarTiming = "timed" | "allDay" | "legacyDate";
export interface CalendarSpan {
  startAt: string;
  endAt: string | null;
  timing: CalendarTiming;
}

/** Both all-day and timed ends are exclusive. */
export function calendarSpanOnDay(entry: CalendarSpan, day: Date, timeZone: string): boolean {
  const dayKey = dateKeyInTimeZone(day, timeZone);
  if (entry.timing !== "timed") {
    const startKey = entry.startAt.slice(0, 10);
    const endKey = entry.endAt?.slice(0, 10) ?? addDateDays(startKey, 1);
    return dayKey >= startKey && dayKey < endKey;
  }
  const dayStart = dayInstant(dayKey, timeZone);
  const dayEnd = dayInstant(addDateDays(dayKey, 1), timeZone);
  const start = new Date(entry.startAt);
  const end = entry.endAt ? new Date(entry.endAt) : new Date(start.getTime() + 1);
  return start < dayEnd && end > dayStart;
}

/** The single hour row in which a timed event is rendered for this day. */
export function calendarStartHour(
  entry: CalendarSpan,
  day: Date,
  timeZone: string
): { hour: number; continuation: boolean } | null {
  if (entry.timing !== "timed" || !calendarSpanOnDay(entry, day, timeZone)) return null;
  const dayKey = dateKeyInTimeZone(day, timeZone);
  const start = new Date(entry.startAt);
  if (dateKeyInTimeZone(start, timeZone) !== dayKey) return { hour: DAY_START_HOUR, continuation: true };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(start);
  return {
    hour: Number(parts.find((part) => part.type === "hour")!.value),
    continuation: false,
  };
}
