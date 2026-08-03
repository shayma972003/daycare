/**
 * Locale constants and lookup — usable from **both** server and client.
 *
 * Deliberately has no `"use client"` directive and no React. The provider and
 * hooks live in `i18n-provider.tsx`; they need the directive, and a directive
 * marks the whole module, so putting them together made `isLocale` and
 * `directionFor` unreachable from the root layout — which is a server component
 * and is exactly where the language must be resolved for the first paint.
 *
 * `locales/en.json` was already complete — 259 keys, none missing — and had no
 * way to be reached: `t()` imported the Arabic file directly. This is the wiring
 * that was missing, not a translation effort (task 2.36).
 */

import ar from "../../locales/ar.json";
import en from "../../locales/en.json";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "ar";

export const LOCALE_LABELS: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};

const DICTIONARIES: Record<Locale, unknown> = { ar, en };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

/** RTL is a property of the language, so it is derived rather than stored. */
export function directionFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

function lookup(dictionary: unknown, key: string): string | null {
  let current: unknown = dictionary;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

/**
 * Resolves a dotted key.
 *
 * Falls back to Arabic before falling back to the key itself: a missing English
 * string should show the Arabic one, which a user can at least act on, rather
 * than a raw `students.profile.title` that tells them nothing.
 */
export function translate(locale: Locale, key: string): string {
  return lookup(DICTIONARIES[locale], key) ?? lookup(ar, key) ?? key;
}
