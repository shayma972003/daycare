"use client";

/**
 * The React half of language switching (task 2.36).
 *
 * Split from `i18n.ts` because `"use client"` marks an entire module: with the
 * pure helpers in here, the root layout — a server component — could not call
 * `isLocale`, and every request rendered an error page. The constants and the
 * lookup live next door; only the provider and the hooks are here.
 *
 * Why a context rather than making `translate()` locale-aware in place: it is a
 * plain synchronous function, so a locale-aware version needs module-level
 * state. On the server that state is shared between concurrent requests, which
 * means one user's language choice could render into another's page. A context
 * is per-render and cannot do that.
 *
 * The preference is stored in a **cookie**, not localStorage, so the server can
 * read it while rendering and the first paint is already in the right language
 * and direction. localStorage would produce a flash of Arabic before the switch,
 * and on an RTL→LTR change that is the whole layout jumping.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  directionFor,
  translate,
  type Locale,
} from "@/lib/i18n";

/** Accepts placeholder values, so a sentence is one key rather than fragments. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Translate;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);

    // A year, path-wide, `SameSite=Lax` so it survives normal navigation but is
    // not sent cross-site. Not httpOnly on purpose: the client is what sets it,
    // and a language preference is not a secret.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    // `<html>` is owned by the server-rendered layout, so its attributes are
    // updated directly rather than through React — switching language must flip
    // the whole page's direction, not just the subtree under this provider.
    document.documentElement.lang = next;
    document.documentElement.dir = directionFor(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: directionFor(locale),
      t: (key, vars) => translate(locale, key, vars),
      setLocale,
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * The translation function for the current locale.
 *
 * Falls back to Arabic outside a provider so a partially converted tree keeps
 * working — the migration can be done a file at a time rather than in one commit
 * that touches everything.
 */
export function useT(): Translate {
  const context = useContext(LocaleContext);
  const locale = context?.locale ?? DEFAULT_LOCALE;
  return useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale]);
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context) return context;

  return {
    locale: DEFAULT_LOCALE,
    dir: directionFor(DEFAULT_LOCALE),
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
    setLocale: () => {},
  };
}
