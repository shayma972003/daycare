export function normalizePhone(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s+/g, '').replace(/-/g, '');
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
