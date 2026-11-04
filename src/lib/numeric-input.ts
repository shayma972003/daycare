import { normalizeNumerals } from "@/lib/phone-normalizer";

/**
 * Keeps a non-negative money field easy to edit while accepting both Arabic
 * and Latin digits. The browser's number input is intentionally avoided: its
 * spinner and eager numeric coercion make replacing an existing amount feel
 * stuck, especially on mobile.
 */
export function sanitizeMoneyInput(value: string): string {
  const normalized = normalizeNumerals(value)
    .replace(/[٫,]/g, ".")
    .replace(/[^0-9.]/g, "");
  const [whole = "", ...fractionParts] = normalized.split(".");
  if (fractionParts.length === 0) return whole;
  return `${whole}.${fractionParts.join("").slice(0, 2)}`;
}
export function sanitizeIntegerInput(value: string): string {
  return normalizeNumerals(value).replace(/[^0-9]/g, "");
}

export function moneyInputValue(value: string, emptyValue: number): number;
export function moneyInputValue(value: string, emptyValue: null): number | null;
export function moneyInputValue(value: string, emptyValue: number | null): number | null {
  if (value.trim() === "") return emptyValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : emptyValue;
}

