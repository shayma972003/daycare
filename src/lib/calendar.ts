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

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  day: "يوم",
  week: "أسبوع",
  month: "شهر",
};

/**
 * Keys, not text. A resolved table here is read once at import and keeps the
 * language it was first loaded in for the rest of the session.
 */
export const EVENT_TYPE_LABEL_KEYS: Record<CalendarEventType, string> = {
  LESSON: "calendar.typeLESSON",
  ACTIVITY: "calendar.typeACTIVITY",
  ANNOUNCEMENT: "calendar.typeANNOUNCEMENT",
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
};

/** The hours a nursery day is drawn across. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 19;

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
