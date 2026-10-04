const RIYADH_ZONE = "Asia/Riyadh";

type CalendarSpan = {
  startAt: string;
  endAt: string | null;
  allDay?: boolean;
};

export function riyadhDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDateKeyDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function currentWeekStart(at: Date = new Date()): string {
  const today = riyadhDateKey(at);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return addDateKeyDays(today, -weekday);
}

export function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDateKeyDays(start, index));
}

export function currentMonthGrid(day: string): {
  monthStart: string;
  monthEnd: string;
  gridStart: string;
  gridEnd: string;
  days: string[];
} {
  const monthStart = `${day.slice(0, 7)}-01`;
  const first = new Date(`${monthStart}T00:00:00.000Z`);
  const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const monthEnd = addDateKeyDays(nextMonth.toISOString().slice(0, 10), -1);
  const gridStart = addDateKeyDays(monthStart, -first.getUTCDay());
  const lastWeekday = new Date(`${monthEnd}T00:00:00.000Z`).getUTCDay();
  const gridEnd = addDateKeyDays(monthEnd, 6 - lastWeekday);
  const count = Math.round(
    (new Date(`${gridEnd}T00:00:00.000Z`).getTime() -
      new Date(`${gridStart}T00:00:00.000Z`).getTime()) /
      86_400_000
  ) + 1;
  return { monthStart, monthEnd, gridStart, gridEnd, days: daysFrom(gridStart, count) };
}

export function eventOccursOnDate(event: CalendarSpan, day: string): boolean {
  if (event.allDay) {
    const startKey = event.startAt.slice(0, 10);
    if (!event.endAt) return day === startKey;
    const lastKey = addDateKeyDays(event.endAt.slice(0, 10), -1);
    return day >= startKey && day <= lastKey;
  }

  const startKey = riyadhDateKey(event.startAt);
  if (!event.endAt) return day === startKey;

  // Calendar end values are exclusive. Subtracting one millisecond keeps an
  // event ending exactly at midnight off the following day's list.
  const end = new Date(event.endAt).getTime();
  const lastKey = riyadhDateKey(new Date(Math.max(new Date(event.startAt).getTime(), end - 1)));
  return day >= startKey && day <= lastKey;
}
