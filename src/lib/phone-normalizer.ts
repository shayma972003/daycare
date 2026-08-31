const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeNumerals(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = ARABIC_DIGITS.indexOf(digit);
    if (arabic >= 0) return String(arabic);
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
}

export function cleanPhoneInput(raw: string | number): string {
  return normalizeNumerals(String(raw)).trim().replace(/[\s-]+/g, "");
}

export function normalizePhone(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = cleanPhoneInput(raw);
  if (!s) return null;
  if (s.startsWith('+966')) {
    const rest = s.slice(4);
    if (rest.length === 9 && /^\d+$/.test(rest)) return `+966${rest}`;
  }
  if (s.startsWith('00966')) {
    const rest = s.slice(5);
    if (rest.length === 9 && /^\d+$/.test(rest)) return `+966${rest}`;
  }
  if (s.startsWith('05') && s.length === 10 && /^\d+$/.test(s)) {
    return `+966${s.slice(1)}`;
  }
  if (s.startsWith('5') && s.length === 9 && /^\d+$/.test(s)) {
    return `+966${s}`;
  }
  return null;
}
