"use client";

/**
 * Live password feedback (task 1.13).
 *
 * Five conditions checked as the user types, rather than one error after they
 * submit. The difference matters more than it looks: the policy is 8 characters
 * (src/lib/password-policy.ts) and the rest of these are advisory, so a user who
 * only learns about them on failure will usually just retry the same weak
 * password with one character added.
 *
 * Advisory conditions are shown but not enforced. Forcing a symbol produces
 * "Password1!" — long enough to satisfy a checker and short enough to guess —
 * whereas showing the strength while there is still time to change it nudges
 * without blocking anyone out of their own account.
 */

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useT } from "@/lib/i18n-provider";

export interface PasswordRule {
  id: string;
  /**
   * A key, not a string. Resolving here would freeze every rule to whichever
   * language happened to be active when this module was first imported.
   */
  labelKey: string;
  test: (value: string) => boolean;
  /** Only the required rule blocks submission. */
  required?: boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    labelKey: "passwordRules.length",
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
    required: true,
  },
  { id: "lower", labelKey: "passwordRules.lowercase", test: (v) => /[a-z]/.test(v) },
  { id: "upper", labelKey: "passwordRules.uppercase", test: (v) => /[A-Z]/.test(v) },
  { id: "digit", labelKey: "passwordRules.digit", test: (v) => /\d/.test(v) },
  {
    id: "symbol",
    labelKey: "passwordRules.symbol",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** True when every *required* rule passes — what a submit button should gate on. */
export function meetsRequiredRules(value: string): boolean {
  return PASSWORD_RULES.filter((rule) => rule.required).every((rule) => rule.test(value));
}

export function PasswordRules({ value }: { value: string }) {
  const t = useT();
  // Nothing typed yet: showing five red crosses to someone who has not started
  // reads as failure rather than guidance.
  const started = value.length > 0;

  return (
    <ul className="mt-2 space-y-1" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const passed = rule.test(value);
        const state = !started ? "idle" : passed ? "pass" : "fail";
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs ${
              state === "pass"
                ? "text-emerald-600"
                : state === "fail"
                  ? "text-gray-500"
                  : "text-gray-400"
            }`}
          >
            <span
              aria-hidden
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                state === "pass"
                  ? "bg-emerald-100 text-emerald-600"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {state === "pass" ? "✓" : "•"}
            </span>
            <span>
              {t(rule.labelKey, { n: String(PASSWORD_MIN_LENGTH) })}
              {!rule.required && (
                <span className="text-gray-400"> {t("fields.recommended")}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
