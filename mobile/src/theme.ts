import { I18nManager } from "react-native";

/**
 * The web product's palette, so the two do not look like different companies.
 * Values copied from `src/app/globals.css`.
 */
export const colors = {
  coral: "#F64651",
  coralDark: "#D93A44",
  teal: "#2F96A6",
  tealLight: "#E0F7FA",
  yellow: "#F8B500",
  navy: "#111111",
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#EBEBEB",
  textMuted: "#666666",
  success: "#2D7A4F",
  successBg: "#E8F5EE",
  danger: "#C0232C",
  dangerBg: "#FFE8EA",
  purple: "#7C3AED",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20 } as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

/**
 * Every touch target is at least this tall.
 *
 * The teacher is holding a child in one hand and the phone in the other, often
 * standing. 44pt is Apple's floor and the number below which mis-taps stop
 * being occasional.
 */
export const TOUCH_TARGET = 48;

/**
 * RTL, forced.
 *
 * React Native follows the *device* language, so an Arabic interface on a phone
 * set to English lays out left-to-right — labels on the wrong side, back arrows
 * pointing the wrong way. The product is Arabic-first, so the layout is stated
 * rather than inferred.
 *
 * `allowRTL` must come first; `forceRTL` alone is ignored when RTL is disallowed.
 */
export function enforceRtl(): void {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}
