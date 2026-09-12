import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateInputValue } from "@/lib/datetime";
import { findInvoiceThisMonth, duplicateInvoiceResponse } from "@/lib/invoice-duplicates";
import { moneyMaxZero, moneyMultiply, moneyString, moneySubtract } from "@/lib/money";
import { claimInvoice, completeInvoiceClaim, failInvoiceClaim, idempotencyConflictResponse, invoiceRequestHash, missingIdempotencyKeyResponse, readIdempotencyKey } from "@/lib/invoice-idempotency";
import { teacherLatenessForInvoice } from "@/lib/invoice-lateness";

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

  const teacher = await prisma.teacher.findFirst({
    where: { id, schoolId, deletedAt: null },
  });

  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const claim = await claimInvoice({ schoolId, operationKind: "teacher-direct", key: idempotencyKey, requestHash: invoiceRequestHash({ teacherId: id }), type: "TEACHER" });
  if (claim.state === "completed") return Response.json({ ...claim.invoice, replayed: true }, { status: 200 });
  if (claim.state === "conflict") return idempotencyConflictResponse(claim.code);

  // One salary document per month. `?force=1` reissues after a correction.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const existing = await findInvoiceThisMonth(schoolId, { teacherId: id });
    if (existing) {
      await failInvoiceClaim(claim.id, claim.leaseExpiresAt);
      return duplicateInvoiceResponse(existing);
    }
  }

  const now = new Date();
  const issueDate = astDateInputValue(now);

  // Lateness for *this month only*. `teacher.lateHours` is a cumulative total
  // that is never reset, so using it meant every monthly salary invoice
  // re-deducted the teacher's entire history of lateness, over and over.
  const lateness = await teacherLatenessForInvoice(schoolId, id, now);
  const lateHours = lateness.lateHours;
  const lateDeduction = moneyMultiply(teacher.lateDeductionRate, lateHours);
  const netSalary = moneyMaxZero(moneySubtract(teacher.monthlySalary, lateDeduction));

  const invoiceData = {
    teacherName: teacher.name,
    monthlySalary: moneyString(teacher.monthlySalary),
    lateHours,
    lateDeductionRate: moneyString(teacher.lateDeductionRate),
    lateDeduction: moneyString(lateDeduction),
    netSalary: moneyString(netSalary),
    issueDate,
    periodFrom: lateness.from.toISOString().slice(0, 10),
    periodTo: lateness.to.toISOString().slice(0, 10),
  };

  const invoice = await (async () => {
    await completeInvoiceClaim(claim.id, claim.leaseExpiresAt, {
      schoolId,
      type: "TEACHER",
      teacherId: id,
      amount: netSalary,
      // Explicitly zero, not left to the column default: a salary is not a
      // taxable supply, and stating it here is what tells the next reader the
      // omission is deliberate rather than the bug it was on the other paths.
      vat_amount: 0,
      data: invoiceData,
    });
    return prisma.invoice.findUniqueOrThrow({ where: { id: claim.id }, include: { teacher: true } });
  })().catch(async (error) => {
    await failInvoiceClaim(claim.id, claim.leaseExpiresAt).catch(() => undefined);
    throw error;
  });

  await logAction({
    school_id: schoolId,
    action: `إصدار فاتورة راتب للمعلم: ${teacher.name} — رقم ${invoice.id}`,
    entity_type: "invoice",
    entity_id: invoice.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(invoice, { status: 201 });
}
