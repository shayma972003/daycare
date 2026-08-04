/**
 * Single source of truth for business-day arithmetic.
 *
 * The business day is Arabia Standard Time (UTC+3), which never observes DST, so
 * a fixed offset is exact. Server-local dates are wrong here: on Vercel the host
 * runs in UTC, so between 21:00 and midnight UTC every `new Date(y, m, d)` names
 * yesterday's business day. Routes that mixed the two wrote attendance rows to
 * different dates for the same tap.
 */

const AST_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Midnight of the AST business day containing `at`, as a UTC instant. */
export function astDayStart(at: Date = new Date()): Date {
  const shifted = new Date(at.getTime() + AST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - AST_OFFSET_MS);
}

/** Exclusive end of the AST business day containing `at`. */
export function astDayEnd(at: Date = new Date()): Date {
  return new Date(astDayStart(at).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Today's AST calendar date as `yyyy-mm-dd` — what `<input type="date">` wants.
 *
 * Exists because the obvious spelling is wrong in a way nothing catches.
 * `astDayStart()` returns the *instant* the AST day begins, which is 21:00 UTC
 * on the previous date, so `astDayStart().toISOString().slice(0, 10)` yields
 * **yesterday** — every hour of every day, not only near midnight. Two screens
 * had that as the default departure date, and the departure date is what the
 * five-year retention clock is measured from.
 */
export function astDateInputValue(at: Date = new Date()): string {
  return astDateOnly(at).toISOString().slice(0, 10);
}

/**
 * The `date` value stored on attendance rows (`@db.Date`). Postgres keeps a bare
 * calendar date, so this is midnight UTC of the AST day — comparable by equality.
 */
export function astDateOnly(at: Date = new Date()): Date {
  const shifted = new Date(at.getTime() + AST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  );
}

/** AST calendar parts of an instant. */
export function astParts(at: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(at.getTime() + AST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Resolves an "HH:mm" school setting to a UTC instant on the AST day of `at`.
 *
 * Hours are normalised through epoch arithmetic rather than `setUTCHours(h - 3)`,
 * which silently rolled back a full day for any time earlier than 03:00 and
 * produced ~24 hours of phantom lateness.
 */
export function astTimeOnDay(time: string, at: Date = new Date()): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return new Date(astDayStart(at).getTime() + (hours * 60 + minutes) * 60_000);
}

/**
 * Formats an instant for display in AST, forcing the Gregorian calendar.
 *
 * `locale` follows the interface language. It matters for more than politeness:
 * with the Arabic formatter, an afternoon time renders as `01:09 م` — an Arabic
 * meridiem in the middle of an otherwise English screen. The default stays
 * Arabic so every existing caller behaves exactly as before.
 *
 * The calendar and numbering system are pinned in both cases. `ar-SA` defaults
 * to the Islamic calendar, which once put Hijri dates into an audit log
 * silently (task 0.68), and to Arabic-Indic digits, which no other number in
 * this product uses.
 */
export function formatAst(
  at: Date,
  options: Intl.DateTimeFormatOptions = {},
  locale: "ar" | "en" = "ar"
): string {
  const tag =
    locale === "en" ? "en-GB-u-ca-gregory-nu-latn" : "ar-SA-u-ca-gregory-nu-latn";

  return new Intl.DateTimeFormat(tag, {
    timeZone: "Asia/Riyadh",
    ...options,
  }).format(at);
}

/**
 * The same instant in the Hijri calendar (task 2.35).
 *
 * `ar-SA` defaults to the Islamic calendar, which is why every Gregorian
 * formatter in this codebase pins `-u-ca-gregory` — see task 0.68, where that
 * default silently produced Hijri dates in an audit log. Here it is what we
 * actually want, requested explicitly rather than relied on.
 *
 * `islamic-umalqura` is the Umm al-Qura calendar used officially in Saudi
 * Arabia. Plain `islamic` is a different, calculated variant and can differ by a
 * day — which matters when the date is on a document.
 */
export function formatHijri(
  at: Date,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }
): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
    timeZone: "Asia/Riyadh",
    ...options,
  }).format(at);
}

/**
 * Both calendars, Gregorian first.
 *
 * Gregorian leads because that is what the system stores and what every other
 * screen shows; the Hijri date is the familiar cross-reference beside it, not a
 * replacement. Showing only one would make the pair of dates on a printed
 * document impossible to reconcile.
 */
export function formatDual(at: Date): string {
  // No "هـ" appended here — `Intl` already emits the era marker for the Islamic
  // calendar, and adding one produces "1448 هـ هـ".
  return `${formatAst(at, { year: "numeric", month: "long", day: "numeric" })} · ${formatHijri(at)}`;
}
