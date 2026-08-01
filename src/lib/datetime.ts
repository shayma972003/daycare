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

/** Formats an instant for display in AST, forcing the Gregorian calendar. */
export function formatAst(
  at: Date,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    ...options,
  }).format(at);
}
