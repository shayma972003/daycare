import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { VAT_RATE } from "@/lib/finance";
import { findInvoiceThisMonth, duplicateInvoiceResponse } from "@/lib/invoice-duplicates";

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

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    include: { class: true, guardian: true },
  });

  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // A double click on "issue invoice" used to produce two documents for the same
  // month, both counted as revenue. `?force=1` reissues deliberately.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const existing = await findInvoiceThisMonth(schoolId, { studentId: id });
    if (existing) return duplicateInvoiceResponse(existing);
  }

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { vatRegistered: true } }),
  ]);
  const monthlyStudentFee = settings?.monthlyStudentFee ?? 0;

  const issueDate = new Date().toISOString().split("T")[0];

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
    ? Math.round(((monthlyStudentFee * VAT_RATE) / (1 + VAT_RATE) + Number.EPSILON) * 100) / 100
    : 0;

  const invoiceData = {
    studentName: student.name,
    guardianName: student.guardian?.name ?? "",
    phone: student.guardian?.phone1 ?? student.guardian?.phone2 ?? "",
    class: student.class?.name ?? "",
    period: student.period,
    monthlyFee: monthlyStudentFee,
    vatAmount,
    issueDate,
  };

  const invoice = await prisma.invoice.create({
    data: {
      schoolId,
      type: "STUDENT",
      studentId: id,
      amount: monthlyStudentFee,
      vat_amount: vatAmount,
      data: invoiceData,
    },
    include: { student: true },
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
