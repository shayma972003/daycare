"use client";

/**
 * Language toggle (task 2.36).
 *
 * Two buttons, both always visible, rather than a dropdown or a single
 * "switch to X" toggle. With exactly two languages a dropdown is an extra tap
 * for no information, and a toggle labelled with the *other* language is a
 * perennial source of "did I just switch it, or is that what it is on now?".
 *
 * Each label is written in its own language — العربية, English — because that is
 * readable to someone who cannot read the current one, which is the entire
 * situation this control exists for.
 */

import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-provider";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className="flex gap-1 px-1"
      role="group"
      aria-label={locale === "ar" ? "اللغة" : "Language"}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          lang={option}
          className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all ${
            locale === option
              ? "bg-white/10 text-white/90 font-medium"
              : "text-white/30 hover:text-white/60 hover:bg-white/5"
          }`}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
