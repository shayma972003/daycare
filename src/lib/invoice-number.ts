import { prisma } from "@/lib/prisma";

/**
 * Allocates the next invoice number for a tenant.
 *
 * The previous approach was `count() + 1`. That breaks twice over: two
 * concurrent requests both read the same count and mint the same number, and
 * deleting an invoice makes the next one reuse a number already issued. Neither
 * is acceptable for a document that is, or will become, a tax record.
 *
 * `upsert` with an atomic `increment` serialises allocation at the database, so
 * the sequence never repeats and never goes backwards — even if a number ends up
 * unused because the request later failed. A gap is fine; a duplicate is not.
 */
export type InvoiceKind = "student" | "teacher" | "admin";

const PREFIX: Record<InvoiceKind, string> = {
  student: "INV",
  teacher: "SAL",
  admin: "SINV",
};

export interface AllocatedInvoiceNumber {
  /** Sequence value, e.g. 7. */
  value: number;
  /** Zero-padded display form, e.g. "INV-00007". */
  formatted: string;
}

export async function allocateInvoiceNumber(
  schoolId: string,
  kind: InvoiceKind
): Promise<AllocatedInvoiceNumber> {
  const counter = await prisma.invoiceCounter.upsert({
    where: { schoolId_kind: { schoolId, kind } },
    create: { schoolId, kind, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });

  return {
    value: counter.lastValue,
    formatted: `${PREFIX[kind]}-${String(counter.lastValue).padStart(5, "0")}`,
  };
}

/**
 * Brings the counter up to the highest number already issued.
 *
 * Existing tenants have invoices that predate this table, so starting from zero
 * would re-issue numbers that are already in use. Called once per tenant, the
 * first time a number is allocated after the migration.
 */
export async function seedInvoiceCounter(
  schoolId: string,
  kind: InvoiceKind,
  highestExisting: number
): Promise<void> {
  if (highestExisting <= 0) return;

  const existing = await prisma.invoiceCounter.findUnique({
    where: { schoolId_kind: { schoolId, kind } },
    select: { lastValue: true },
  });

  if (existing && existing.lastValue >= highestExisting) return;

  await prisma.invoiceCounter.upsert({
    where: { schoolId_kind: { schoolId, kind } },
    create: { schoolId, kind, lastValue: highestExisting },
    update: { lastValue: highestExisting },
  });
}
