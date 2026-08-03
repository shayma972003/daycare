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

/** Human-readable size. Arabic UI, Latin numerals — matching the rest. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ميغابايت`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} غيغابايت`;
}

export const STORAGE_CATEGORY_LABELS = {
  studentFilesBytes: "ملفات الأطفال",
  careReportBytes: "صور تقارير الرعاية",
  staffFilesBytes: "ملفات الطاقم",
  unitFilesBytes: "ملفات الوحدات",
  invoiceBytes: "الفواتير",
  otherBytes: "أخرى",
  totalBytes: "الإجمالي",
} as const;
