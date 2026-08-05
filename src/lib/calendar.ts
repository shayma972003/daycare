/**
 * Calendar shapes and range arithmetic.
 *
 * All three views are the same query over a different range, so the range
 * calculation lives here and the components only decide how to draw what comes
 * back.
 */

import { astDayStart, astParts } from "@/lib/datetime";
import type { CalendarEventType } from "@/generated/prisma/enums";

export type CalendarView = "day" | "week" | "month";

export const CALENDAR_VIEW_LABEL_KEYS: Record<CalendarView, string> = {
  day: "calendarView.day",
  week: "calendarView.week",
  month: "calendarView.month",
};

/**
 * Keys, not text. A resolved table here is read once at import and keeps the
 * language it was first loaded in for the rest of the session.
 */
export const EVENT_TYPE_LABEL_KEYS: Record<CalendarEventType, string> = {
  LESSON: "calendar.typeLESSON",
  ACTIVITY: "calendar.typeACTIVITY",
  ANNOUNCEMENT: "calendar.typeANNOUNCEMENT",
  UNIT: "calendar.typeUNIT",
};

/**
 * One colour per type, as literal Tailwind classes.
 *
 * Not built by interpolation (`bg-${colour}-100`) — Tailwind scans source text
 * for complete class names, and a constructed one is never emitted into the
 * stylesheet, so the block renders unstyled.
 */
export const EVENT_TYPE_STYLES: Record<CalendarEventType, string> = {
  LESSON: "bg-[#E0F7FA] border-[#2F96A6] text-[#12626f]",
  ACTIVITY: "bg-[#FFF1E6] border-[#F8B500] text-[#8a5a00]",
  ANNOUNCEMENT: "bg-[#FFE8EA] border-[#F64651] text-[#8f1f27]",
  UNIT: "bg-[#F3EEFF] border-[#7C3AED] text-[#4c1d95]",
};

/** The hours a nursery day is drawn across. */
export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 23;

/**
 * Which hour rows an entry occupies on a given day.
 *
 * A lesson from 17:00 to 19:00 used to be a single cell at 17:00, so two rooms
 * booked 17:00–19:00 and 18:00–19:00 looked like they never met. The row an
 * entry sits in is what "does this clash" is read from, and one row cannot
 * answer it.
 *
 * `endHour`/`endMinute` are null when the entry finishes on a later day, in
 * which case it runs to the end of this one.
 */
export function hoursOccupied(
  startHour: number,
  startMinute: number,
  endHour: number | null,
  endMinute: number | null
): number[] {
  const last =
    endHour === null
      ? DAY_END_HOUR
      : // Ending exactly on the hour does not occupy it: 17:00–19:00 fills 17
        // and 18, leaving 19:00 free for whatever follows. A zero-length entry
        // still shows in its own row rather than none.
        endMinute === 0 && endHour > startHour
        ? endHour - 1
        : endHour;

  const hours: number[] = [];
  for (let hour = startHour; hour <= Math.min(last, DAY_END_HOUR); hour++) hours.push(hour);
  return hours.length > 0 ? hours : [startHour];
}

/**
 * Whether an entry runs on a given calendar day.
 *
 * Compared by AST day rather than by instant: one ending at 09:00 on the 19th
 * still belongs on the 19th, and one starting at 23:00 does not belong on the
 * 20th. A missing end means a single day.
 */
export function coversDay(start: Date, end: Date | null, day: Date): boolean {
  const startDay = astDayStart(start).getTime();
  const target = astDayStart(day).getTime();
  if (startDay === target) return true;
  if (!end) return false;
  const endDay = astDayStart(end).getTime();
  return startDay < target && target <= endDay;
}

/**
 * An hour label, in the 12-hour clock the reader actually speaks.
 *
 * Built by hand rather than through `Intl.DateTimeFormat`, because the grid
 * labels an *hour of the day*, not an instant — there is no date to format, and
 * inventing one drags the time zone into a row heading that has nothing to do
 * with a moment in time.
 *
 * Arabic uses ص/م, English am/pm. Latin digits in both, matching every other
 * number in the product.
 */
export function hourLabel(hour: number, locale: "ar" | "en" = "ar"): string {
  const suffix =
    hour < 12 ? (locale === "en" ? "am" : "ص") : locale === "en" ? "pm" : "م";
  // 0 and 12 are both "12" on a 12-hour clock — midnight and noon.
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

export interface CalendarRange {
  from: Date;
  to: Date;
  /** The days to render as columns or cells. */
  days: Date[];
}

/**
 * The range a view covers around an anchor date.
 *
 * The week starts on Sunday and the month grid is padded to whole weeks, so the
 * Saudi working week (Sunday–Thursday) reads left to right without the weekend
 * splitting it.
 */
export function rangeFor(view: CalendarView, anchor: Date): CalendarRange {
  const day = astDayStart(anchor);

  if (view === "day") {
    const to = new Date(day.getTime() + 86400000);
    return { from: day, to, days: [day] };
  }

  if (view === "week") {
    const parts = astParts(day);
    const weekday = new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay();
    const from = new Date(day.getTime() - weekday * 86400000);
    const days = Array.from({ length: 7 }, (_, index) =>
      new Date(from.getTime() + index * 86400000)
    );
    return { from, to: new Date(from.getTime() + 7 * 86400000), days };
  }

  // Month, padded to whole weeks so the grid is rectangular.
  const parts = astParts(day);
  const firstOfMonth = astDayStart(new Date(Date.UTC(parts.year, parts.month, 1, 12)));
  const firstWeekday = new Date(
    Date.UTC(astParts(firstOfMonth).year, astParts(firstOfMonth).month, astParts(firstOfMonth).day)
  ).getUTCDay();

  const from = new Date(firstOfMonth.getTime() - firstWeekday * 86400000);
  const lastOfMonth = astDayStart(new Date(Date.UTC(parts.year, parts.month + 1, 0, 12)));
  const lastWeekday = new Date(
    Date.UTC(astParts(lastOfMonth).year, astParts(lastOfMonth).month, astParts(lastOfMonth).day)
  ).getUTCDay();
  const to = new Date(lastOfMonth.getTime() + (7 - lastWeekday) * 86400000);

  const days: Date[] = [];
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += 86400000) {
    days.push(new Date(cursor));
  }

  return { from, to, days };
}

/** Moves the anchor by one unit of the current view. */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "day") return new Date(anchor.getTime() + direction * 86400000);
  if (view === "week") return new Date(anchor.getTime() + direction * 7 * 86400000);

  const parts = astParts(anchor);
  // Day 1 avoids the 31st-of-January problem: adding a month to the 31st would
  // otherwise skip February entirely.
  return astDayStart(new Date(Date.UTC(parts.year, parts.month + direction, 1, 12)));
}

/** Same AST calendar day — the test the day columns group on. */
export function isSameAstDay(a: Date, b: Date): boolean {
  const first = astParts(a);
  const second = astParts(b);
  return (
    first.year === second.year && first.month === second.month && first.day === second.day
  );
}

export function isSameAstMonth(a: Date, b: Date): boolean {
  const first = astParts(a);
  const second = astParts(b);
  return first.year === second.year && first.month === second.month;
}
