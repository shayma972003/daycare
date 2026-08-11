export const PLATFORM_BRAND = {
  ar: "طفولة تك",
  en: "Tofolah Tech",
} as const;

export type PlatformLanguage = keyof typeof PLATFORM_BRAND;

export function platformName(language: PlatformLanguage = "ar"): string {
  return PLATFORM_BRAND[language];
}
