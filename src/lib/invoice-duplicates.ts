import { prisma } from "@/lib/prisma";
import { astParts, astDayStart } from "@/lib/datetime";

/**
 * Guards against issuing a second invoice to the same subject in the same month.
 *
 * Nothing stopped it before: every "issue invoice" button was a plain create, so
 * a double click, an impatient retry after a slow PDF render, or a second pass
 * through a monthly billing run produced two documents for one month's fees.
 * Both then counted as revenue, both showed as owed, and one of them had to be
 * cancelled by hand once someone noticed.
 *
 * Deliberately an application check rather than a unique constraint. A database
 * constraint needs a stored billing-period column, and the invoice tables hold
 * live rows whose period is only implied by `createdAt` — adding and backfilling
 * that column is a bigger change than this defect warrants. The trade-off is
 * that two genuinely simultaneous requests can still slip through; the window is
 * milliseconds, and the failure mode it removes is the one that actually happens.
 *
 * A caller can override with `force` — reissuing after a correction is a real
 * need, and a guard with no escape hatch gets deleted the first time it is in
 * the way.
 */
export interface DuplicateCheckTarget {
  studentId?: string | null;
  teacherId?: string | null;
}

/** Start of the AST calendar month containing `at`, as a UTC instant. */
export function astMonthStart(at: Date = new Date()): Date {
  const { year, month } = astParts(at);
  return astDayStart(new Date(Date.UTC(year, month, 1, 12)));
}

/** Exclusive end of the AST calendar month containing `at`. */
export function astMonthEnd(at: Date = new Date()): Date {
  const { year, month } = astParts(at);
  return astDayStart(new Date(Date.UTC(year, month + 1, 1, 12)));
}

/**
 * Returns the clashing invoice, or null when it is safe to issue.
 *
 * Month boundaries come from the AST helpers, not from the server clock: an
 * invoice raised at 01:00 Riyadh time on the 1st belongs to the new month, and
 * UTC arithmetic would file it under the old one.
 */
export async function findInvoiceThisMonth(
  schoolId: string,
  target: DuplicateCheckTarget,
  at: Date = new Date()
): Promise<{ id: string; createdAt: Date } | null> {
  if (!target.studentId && !target.teacherId) return null;

  return prisma.invoice.findFirst({
    where: {
      schoolId,
      ...(target.studentId ? { studentId: target.studentId } : {}),
      ...(target.teacherId ? { teacherId: target.teacherId } : {}),
      createdAt: { gte: astMonthStart(at), lt: astMonthEnd(at) },
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 409 body for a duplicate. Includes the existing invoice id so the UI can offer
 * to open it instead of silently failing.
 */
export function duplicateInvoiceResponse(existing: { id: string }): Response {
  return Response.json(
    {
      error: "توجد فاتورة صادرة لهذا الشهر بالفعل",
      existingInvoiceId: existing.id,
      code: "DUPLICATE_INVOICE",
    },
    { status: 409 }
  );
}
