import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatAst } from "@/lib/datetime";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


export function replaceVariables(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/<(\w+)>/g, (match, key) => {
    return vars[key] ?? match;
  });
}

/**
 * Date for display.
 *
 * Two defects in the previous version, neither of them the calendar — `ar-SA`
 * resolves to `gregory` in practice, so these were not producing Hijri dates:
 *
 * 1. **No time zone.** `toLocaleDateString` uses the host's zone, and on Vercel
 *    that is UTC. Between 21:00 and midnight in Riyadh every date on every
 *    screen named the previous day. The same class of bug task 0.64 introduced
 *    `datetime.ts` to eliminate, missed here because these helpers predate it.
 *
 * 2. **Arabic-Indic numerals.** `ar-SA` renders "٠٣/٠٨/٢٠٢٦" while `formatAst`
 *    pins `nu-latn` and renders "03/08/2026" — so a date shown by one helper and
 *    the same date shown by the other looked like different data.
 *
 * Both fixed by routing through `formatAst`, which is the single definition of
 * how this product writes a date.
 */
/**
 * `locale` is optional so server code and older callers keep the Arabic
 * formatting they have always produced; screens pass the interface language.
 */
export function formatDate(
  date: Date | string | null | undefined,
  locale: "ar" | "en" = "ar"
): string {
  if (!date) return "—";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return formatAst(value, { year: "numeric", month: "2-digit", day: "2-digit" }, locale);
}

export function formatTime(
  date: Date | string | null | undefined,
  locale: "ar" | "en" = "ar"
): string {
  if (!date) return "—";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return formatAst(value, { hour: "2-digit", minute: "2-digit" }, locale);
}

/**
 * Money.
 *
 * `toLocaleString("ar-SA")` gives Arabic-Indic digits; every other number in the
 * product is Latin, and a figure that changes shape depending on which helper
 * printed it is worse than either choice consistently applied.
 */
export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString("ar-SA-u-nu-latn")} ر.س`;
}
