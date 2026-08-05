/**
 * Display helpers for storage figures.
 *
 * Split out of `storage-usage.ts` because that module opens a database
 * connection at import time. The settings screen is a Client Component and only
 * wants to format a number; importing it from there dragged Prisma and `pg` into
 * the browser bundle, which fails the production build with a stack of
 * `node:module` resolution errors that say nothing about the actual cause.
 *
 * Nothing here touches the database, so it is safe on either side.
 */

/**
 * Human-readable size. Latin numerals in both languages, matching the rest.
 *
 * Takes `t` rather than calling a hook: this is also reached from server code,
 * where there is no React context to read a locale from. Callers without one
 * get Arabic, which is what every caller produced before.
 */
export function formatBytes(
  bytes: number,
  t?: (key: string, vars?: Record<string, string>) => string
): string {
  const say = (key: string, n: string) =>
    t ? t(`bytes.${key}`, { n }) : `${n} ${FALLBACK_UNITS[key]}`;

  if (bytes < 1024) return say("b", String(bytes));
  if (bytes < 1024 * 1024) return say("kb", (bytes / 1024).toFixed(1));
  if (bytes < 1024 * 1024 * 1024) return say("mb", (bytes / (1024 * 1024)).toFixed(1));
  return say("gb", (bytes / (1024 * 1024 * 1024)).toFixed(2));
}

const FALLBACK_UNITS: Record<string, string> = {
  b: "بايت",
  kb: "كيلوبايت",
  mb: "ميغابايت",
  gb: "غيغابايت",
};

export const STORAGE_CATEGORY_LABEL_KEYS: Record<string, string> = {
  studentFilesBytes: "storageCategory.studentFilesBytes",
  careReportBytes: "storageCategory.careReportBytes",
  staffFilesBytes: "storageCategory.staffFilesBytes",
  unitFilesBytes: "storageCategory.unitFilesBytes",
  invoiceBytes: "storageCategory.invoiceBytes",
  otherBytes: "storageCategory.otherBytes",
  totalBytes: "storageCategory.totalBytes",
};

export const STORAGE_CATEGORY_LABELS = {
  studentFilesBytes: "ملفات الأطفال",
  careReportBytes: "صور تقارير الرعاية",
  staffFilesBytes: "ملفات الطاقم",
  unitFilesBytes: "ملفات الوحدات",
  invoiceBytes: "الفواتير",
  otherBytes: "أخرى",
  totalBytes: "الإجمالي",
} as const;
