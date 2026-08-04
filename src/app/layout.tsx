import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, DEFAULT_LOCALE, directionFor, isLocale, translate } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n-provider";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

/**
 * A function, not a constant: the browser tab title is the one piece of UI that
 * renders before any component does, so it has to read the same cookie the
 * layout below reads rather than the client-side locale.
 */
export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const preferred = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(preferred) ? preferred : DEFAULT_LOCALE;
  return {
    title: translate(locale, "app.title"),
    description: translate(locale, "app.description"),
  };
}

/**
 * Reads the language from a cookie so the very first paint is already in the
 * right language and direction.
 *
 * The alternative — reading a preference on the client after mount — renders the
 * page in Arabic, then flips it. On a right-to-left/left-to-right switch that is
 * not a subtle flash; the entire layout jumps.
 *
 * Reading `cookies()` makes this route dynamic, which is correct here: every
 * page behind it is already per-user.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const preferred = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(preferred) ? preferred : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body className={`${tajawal.variable} font-[family-name:var(--font-tajawal)] min-h-screen bg-[#f4f6fb]`}>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
