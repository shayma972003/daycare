import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { VAT_RATE } from "@/lib/finance";
import { findInvoiceThisMonth, duplicateInvoiceResponse } from "@/lib/invoice-duplicates";
import { astDateInputValue } from "@/lib/datetime";
import { money, moneyString } from "@/lib/money";
import { claimInvoice, completeInvoiceClaim, failInvoiceClaim, idempotencyConflictResponse, invoiceRequestHash, missingIdempotencyKeyResponse, readIdempotencyKey } from "@/lib/invoice-idempotency";
import { resolveStudentCycleFee } from "@/lib/student-cycle-fee";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return missingIdempotencyKeyResponse();

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    include: { class: true, guardian: true },
  });

  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const claim = await claimInvoice({ schoolId, operationKind: "student-direct", key: idempotencyKey, requestHash: invoiceRequestHash({ studentId: id }), type: "STUDENT" });
  if (claim.state === "completed") return Response.json({ ...claim.invoice, replayed: true }, { status: 200 });
  if (claim.state === "conflict") return idempotencyConflictResponse(claim.code);

  // A double click on "issue invoice" used to produce two documents for the same
  // month, both counted as revenue. `?force=1` reissues deliberately.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const existing = await findInvoiceThisMonth(schoolId, { studentId: id });
    if (existing) {
      await failInvoiceClaim(claim.id, claim.leaseExpiresAt);
      return duplicateInvoiceResponse(existing);
    }
  }

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { vatRegistered: true } }),
  ]);
  const subscriptionFee = resolveStudentCycleFee(student.billingCycle, student.cycleFee, settings);
  if (subscriptionFee === null) {
    await failInvoiceClaim(claim.id, claim.leaseExpiresAt);
    return Response.json({ error: "Subscription fee is not configured", code: "CYCLE_FEE_REQUIRED" }, { status: 422 });
  }

  const issueDate = astDateInputValue();

  /**
   * VAT is computed and stored, not left at the column default.
   *
   * `vat_amount` was written by exactly one of the five invoice-creation paths,
   * so most invoices recorded zero tax regardless of the school's registration —
   * and the finance layer, which subtracts VAT out of revenue, was reading a
   * figure that had never been calculated. The fee is treated as VAT-inclusive
   * (it is the price a guardian is quoted), so the tax is extracted from it
   * rather than added on top, which would silently raise everybody's bill.
   */
  const vatAmount = school?.vatRegistered
    ? money(subscriptionFee).mul(VAT_RATE).div(1 + VAT_RATE).toDecimalPlaces(2)
    : money(0);

  const invoiceData = {
    studentName: student.name,
    guardianName: student.guardian?.name ?? "",
    phone: student.guardian?.phone1 ?? student.guardian?.phone2 ?? "",
    class: student.class?.name ?? "",
    period: student.period,
    monthlyFee: moneyString(subscriptionFee),
    vatAmount: moneyString(vatAmount),
    issueDate,
  };

  const invoice = await (async () => {
    await completeInvoiceClaim(claim.id, claim.leaseExpiresAt, {
      schoolId,
      type: "STUDENT",
      studentId: id,
      amount: subscriptionFee,
      vat_amount: vatAmount,
      data: invoiceData,
    });
    return prisma.invoice.findUniqueOrThrow({ where: { id: claim.id }, include: { student: true } });
  })().catch(async (error) => {
    await failInvoiceClaim(claim.id, claim.leaseExpiresAt).catch(() => undefined);
    throw error;
  });

  await logAction({
    school_id: schoolId,
    action: `إصدار فاتورة للطالب: ${student.name} — رقم ${invoice.id}`,
    entity_type: "invoice",
    entity_id: invoice.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(invoice, { status: 201 });
}
