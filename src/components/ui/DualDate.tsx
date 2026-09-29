"use client";

/**
 * A date shown in both calendars (task 2.35).
 *
 * Gregorian on top, Hijri beneath in smaller type. Not side by side: at a glance
 * one of them is the answer and the other is the cross-reference, and stacking
 * makes which is which unambiguous.
 *
 * `<time dateTime>` carries the machine-readable ISO value, so the rendered text
 * can be as localised as it likes without the underlying instant becoming
 * guesswork for anyone copying it.
 */

import { formatAst, formatHijri } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n-provider";

export function DualDate({
  value,
  className = "",
  showHijri = true,
}: {
  value: Date | string | null | undefined;
  className?: string;
  showHijri?: boolean;
}) {
  const { locale } = useLocale();
  if (!value) return <span className={className}>—</span>;

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>;

  return (
    <time dateTime={date.toISOString()} className={`inline-block ${className}`}>
      <span className="block">
        {formatAst(date, { year: "numeric", month: "long", day: "numeric" }, locale)}
      </span>
      {/* No "هـ" appended — Intl already emits the era marker for the Islamic
          calendar, and adding one renders "1448 هـ هـ". */}
      {showHijri && (
        <span className="block text-[11px] text-gray-400">{formatHijri(date, undefined, locale)}</span>
      )}
    </time>
  );
}
