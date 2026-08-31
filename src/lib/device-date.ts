/** Date-only values stay calendar dates; never convert stored dates through a zone. */
export const DAY_MS = 86_400_000;

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}

/** Older callers without a device zone use UTC, never a guessed city. */
export function requestTimeZone(request: Request): string {
  const zone = request.headers.get("X-Time-Zone") ?? "UTC";
  if (!validTimeZone(zone)) throw new Error("INVALID_TIME_ZONE");
  return zone;
}

export function calendarToday(at: Date = new Date(), timeZone: string = deviceTimeZone()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (name: string) => Number(parts.find((p) => p.type === name)!.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

/** Calendar-date value for date inputs, derived in the user's device zone. */
export function deviceDateInputValue(at: Date = new Date(), timeZone: string = deviceTimeZone()): string {
  return calendarToday(at, timeZone).toISOString().slice(0, 10);
}

/** Sunday-start week containing the device-local calendar day. */
export function deviceWeekStart(at: Date = new Date(), timeZone: string = deviceTimeZone()): Date {
  const today = calendarToday(at, timeZone);
  return new Date(today.getTime() - today.getUTCDay() * DAY_MS);
}

export function storedDate(value: Date | string): Date {
  return new Date(`${(value instanceof Date ? value.toISOString() : value).slice(0, 10)}T00:00:00.000Z`);
}

export function dateLabel(value: Date | string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: "UTC", calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(storedDate(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  // Arabic Intl literals contain bidi marks, which reorder a date even inside
  // an LTR element. Explicit separators keep DD/MM/YYYY stable in both UIs.
  return `${part("day")}/${part("month")}/${part("year")}`;
}

export function formatDeviceTime(at: Date, options: Intl.DateTimeFormatOptions, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-ca-gregory" : "en-GB", options).format(at);
}

/** Converts local midnight to an instant, including DST offsets. */
export function localDayBounds(at: Date, timeZone: string): { start: Date; end: Date } {
  const today = calendarToday(at, timeZone);
  const midnight = (date: Date) => {
    let instant = date.getTime();
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let i = 0; i < 4; i++) {
      const parts = formatter.formatToParts(new Date(instant));
      const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
      const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
      const delta = date.getTime() - wall;
      instant += delta;
      if (!delta) break;
    }
    return new Date(instant);
  };
  return { start: midnight(today), end: midnight(new Date(today.getTime() + DAY_MS)) };
}

export function deviceHeaders(): Record<string, string> {
  return { "X-Time-Zone": deviceTimeZone() };
}
