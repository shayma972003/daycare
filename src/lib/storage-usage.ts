import { prisma } from "@/lib/prisma";
import { formatBytes as formatQuota } from "@/lib/storage-format";

/**
 * Storage accounting (tasks 2.29–2.31).
 *
 * Everything uploaded today lives as a base64 data URI inside a column, so
 * "storage used" is the summed length of those columns. That is an honest
 * measure of what the tenant costs the database — and it is why these figures
 * are noticeably larger than the original files: base64 inflates by about a
 * third.
 *
 * The sums are raw SQL because Prisma cannot express `sum(length(col))`. Each
 * one is a single aggregate over an indexed tenant scope; the reason they are
 * cached in `StorageUsage` is not that any one is slow, but that there are six
 * of them and nobody needs them recomputed on every page load.
 *
 * Since R2 landed (task 0.34) there are two sources and both are summed: bytes
 * still sitting in base64 columns, plus the real object sizes recorded in
 * `StoredFile`. They coexist until the migration has moved everything, and
 * counting only one would misreport a school's usage by whatever share has not
 * moved yet.
 */

export interface StorageBreakdown {
  studentFilesBytes: number;
  careReportBytes: number;
  staffFilesBytes: number;
  unitFilesBytes: number;
  invoiceBytes: number;
  otherBytes: number;
  totalBytes: number;
}

/** `bigint` from Postgres aggregates; `Number` is safe below 2^53 bytes. */
function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}

async function sumLength(sql: Promise<Array<{ total: unknown }>>): Promise<number> {
  const rows = await sql;
  return toNumber(rows[0]?.total ?? 0);
}

/**
 * Deliberately sequential, not `Promise.all`.
 *
 * Six parallel raw queries open six pooled connections at once, and against a
 * serverless Postgres that is how a background job starts getting connection
 * refusals — which is exactly what happened the first time this ran. The
 * aggregates are milliseconds each; running them one after another costs
 * nothing measurable and removes a whole class of flakiness.
 */
export async function computeStorageUsage(schoolId: string): Promise<StorageBreakdown> {
  /**
   * Bytes in R2, grouped by the category recorded at upload.
   *
   * The object store is the only thing that knows a file's real size and cannot
   * be asked cheaply, so the figure comes from `StoredFile` — written once when
   * the object is created. See prisma/schema.prisma.
   */
  const objects = await prisma.storedFile.groupBy({
    by: ["category"],
    where: { schoolId },
    _sum: { sizeBytes: true },
  });

  const byCategory = new Map(
    objects.map((row) => [row.category, row._sum.sizeBytes ?? 0])
  );
  const objectBytes = (...categories: string[]) =>
    categories.reduce((total, category) => total + (byCategory.get(category) ?? 0), 0);

  // Child avatars, evaluation files and other attachments.
  const studentFiles = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(
      COALESCE(length("avatarUrl"), 0)
      + COALESCE(length("evaluationFileUrl"), 0)
      + COALESCE(length("additionalFile"), 0)
    ), 0) AS total
    FROM "Student" WHERE "schoolId" = ${schoolId}
  `);

  const careReports = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(COALESCE(length("photoUrl"), 0)), 0) AS total
    FROM "CareReport" WHERE "schoolId" = ${schoolId}
  `);

  const staffFiles = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(COALESCE(length("encryptedIdNumber"), 0)), 0) AS total
    FROM "Teacher" WHERE "schoolId" = ${schoolId}
  `);

  const unitFiles = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(COALESCE(length(f."url"), 0)), 0) AS total
    FROM "UnitFile" f
    JOIN "Unit" u ON u."id" = f."unitId"
    WHERE u."schoolId" = ${schoolId}
  `);

  // Rendered PDFs. Usually the single largest category, and the one the "free up
  // space" action targets.
  const invoices = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(COALESCE(length("pdfUrl"), 0)), 0) AS total
    FROM "Invoice" WHERE "schoolId" = ${schoolId}
  `);

  const schoolLogo = await sumLength(prisma.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(COALESCE(length("logoUrl"), 0)), 0) AS total
    FROM "School" WHERE "id" = ${schoolId}
  `);

  /**
   * Both sources are summed, not one or the other.
   *
   * The two coexist for as long as the migration takes: a column still holding a
   * base64 payload costs the database exactly as much as it ever did, and an
   * object in the bucket costs what it weighs. Counting only R2 would show a
   * school its usage dropping to nearly zero before a single byte had actually
   * moved.
   */
  const breakdown: StorageBreakdown = {
    studentFilesBytes: studentFiles + objectBytes("students"),
    careReportBytes: careReports + objectBytes("care"),
    staffFilesBytes: staffFiles + objectBytes("staff"),
    unitFilesBytes: unitFiles + objectBytes("units"),
    invoiceBytes: invoices,
    otherBytes: schoolLogo + objectBytes("school", "activities", "classes"),
    totalBytes: 0,
  };

  breakdown.totalBytes =
    breakdown.studentFilesBytes +
    breakdown.careReportBytes +
    breakdown.staffFilesBytes +
    breakdown.unitFilesBytes +
    breakdown.invoiceBytes +
    breakdown.otherBytes;

  return breakdown;
}

/** Recomputes and caches. Returns the fresh figures. */
export async function refreshStorageUsage(schoolId: string): Promise<StorageBreakdown> {
  const breakdown = await computeStorageUsage(schoolId);

  await prisma.storageUsage.upsert({
    where: { schoolId },
    create: { schoolId, ...breakdown, computedAt: new Date() },
    update: { ...breakdown, computedAt: new Date() },
  });

  return breakdown;
}

export interface StorageQuota {
  usedBytes: number;
  quotaBytes: number | null;
  /** Null when there is no quota — the UI shows a figure, not a bar. */
  percentUsed: number | null;
  over: boolean;
  computedAt: Date | null;
}

/**
 * Usage against the plan's allowance.
 *
 * Reads the cache and only computes when there is none, so opening the settings
 * screen is cheap. `max_storage_mb = 0` means unlimited, matching the student
 * and class limits.
 */
export async function getStorageQuota(schoolId: string): Promise<StorageQuota & StorageBreakdown> {
  const [cached, school] = await Promise.all([
    prisma.storageUsage.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { subscription_plan: { select: { max_storage_mb: true } } },
    }),
  ]);

  const breakdown: StorageBreakdown = cached
    ? {
        studentFilesBytes: cached.studentFilesBytes,
        careReportBytes: cached.careReportBytes,
        staffFilesBytes: cached.staffFilesBytes,
        unitFilesBytes: cached.unitFilesBytes,
        invoiceBytes: cached.invoiceBytes,
        otherBytes: cached.otherBytes,
        totalBytes: cached.totalBytes,
      }
    : await refreshStorageUsage(schoolId);

  const quotaMb = school?.subscription_plan?.max_storage_mb ?? 0;
  const quotaBytes = quotaMb > 0 ? quotaMb * 1024 * 1024 : null;

  return {
    ...breakdown,
    usedBytes: breakdown.totalBytes,
    quotaBytes,
    percentUsed: quotaBytes
      ? Math.min(100, Math.round((breakdown.totalBytes / quotaBytes) * 100))
      : null,
    over: quotaBytes !== null && breakdown.totalBytes > quotaBytes,
    computedAt: cached?.computedAt ?? new Date(),
  };
}

/**
 * Gate for upload routes (task 2.31).
 *
 * Checked against the **cached** figure, deliberately. A live recompute on every
 * upload would put six aggregates in front of every photo a teacher attaches,
 * and the consequence of the cache lagging is that a school briefly goes a few
 * megabytes over — which is not a consequence worth that cost.
 *
 * Returns null when the upload may proceed.
 */
export async function storageBlockReason(
  schoolId: string,
  incomingBytes = 0
): Promise<string | null> {
  const quota = await getStorageQuota(schoolId);
  if (quota.quotaBytes === null) return null;

  if (quota.usedBytes + incomingBytes > quota.quotaBytes) {
    return `تم تجاوز مساحة التخزين المتاحة (${formatQuota(quota.quotaBytes)}). احذفي ملفات أو رقّي الخطة.`;
  }

  return null;
}

/**
 * Deletes stored invoice PDFs (task 2.30).
 *
 * Invoices are usually the largest category and the safest to clear: the PDF is
 * a *rendering*, and every figure needed to produce it again is in `amount`,
 * `vat_amount` and the `data` JSON beside it. Nothing about the financial record
 * is lost.
 *
 * Nothing else is offered as one-click reclaimable — a child's photo cannot be
 * regenerated, so deleting it in bulk to save space is a decision for the file,
 * not for a button.
 */
export async function purgeInvoicePdfs(
  schoolId: string,
  olderThan?: Date
): Promise<{ cleared: number; freedBytes: number }> {
  const before = await computeStorageUsage(schoolId);

  const { count } = await prisma.invoice.updateMany({
    where: {
      schoolId,
      pdfUrl: { not: null },
      ...(olderThan ? { createdAt: { lt: olderThan } } : {}),
    },
    data: { pdfUrl: null },
  });

  const after = await refreshStorageUsage(schoolId);

  return { cleared: count, freedBytes: before.totalBytes - after.totalBytes };
}

/**
 * Re-exported so server callers have one import, but *defined* in
 * `storage-format.ts`, which touches no database. A Client Component importing
 * a formatter from here would pull Prisma and `pg` into the browser bundle.
 */
export { formatBytes, STORAGE_CATEGORY_LABELS } from "@/lib/storage-format";
