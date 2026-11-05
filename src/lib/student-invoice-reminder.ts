import "server-only";

import { astMonthStart, findInvoiceThisMonth } from "@/lib/invoice-duplicates";
import { decodeStoredInvoicePdf, renderStoredInvoicePdf } from "@/lib/invoice-pdf";
import type { EmailAttachment } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

type InvoiceRoutePayload = {
  id?: string;
  existingInvoiceId?: string;
  error?: string;
  code?: string;
};

export class StudentInvoiceReminderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "INVOICE_ATTACHMENT_FAILED"
  ) {
    super(message);
    this.name = "StudentInvoiceReminderError";
  }
}

async function createInvoiceForReminder(request: Request, schoolId: string, studentId: string) {
  const existing = await findInvoiceThisMonth(schoolId, { studentId });
  if (existing) return existing.id;

  const { POST } = await import("@/app/api/students/[id]/invoice/route");
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  headers.set(
    "Idempotency-Key",
    `reminder-invoice:${studentId}:${astMonthStart().toISOString().slice(0, 10)}`
  );
  const invoiceRequest = new Request(
    new URL(`/api/students/${encodeURIComponent(studentId)}/invoice`, request.url),
    { method: "POST", headers }
  );
  const response = await POST(invoiceRequest, { params: Promise.resolve({ id: studentId }) });
  const payload = await response.json().catch(() => ({})) as InvoiceRoutePayload;

  if (response.ok && payload.id) return payload.id;
  if (payload.code === "DUPLICATE_INVOICE" && payload.existingInvoiceId) {
    return payload.existingInvoiceId;
  }
  throw new StudentInvoiceReminderError(
    payload.error ?? "تعذر إنشاء فاتورة الطفل",
    response.status >= 400 ? response.status : 500,
    payload.code ?? "INVOICE_CREATION_FAILED"
  );
}

/**
 * Returns this month's child invoice as an in-memory PDF attachment.
 *
 * The PDF is never made public and is not copied into a second storage row. An
 * existing invoice is reused; otherwise the regular tenant-scoped invoice route
 * creates one with its normal pricing, VAT, audit and idempotency safeguards.
 */
export async function studentInvoiceReminderAttachment(
  request: Request,
  schoolId: string,
  studentId: string
): Promise<{ invoiceId: string; attachment: EmailAttachment }> {
  const invoiceId = await createInvoiceForReminder(request, schoolId, studentId);
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      schoolId,
      studentId,
      type: "STUDENT",
      generationStatus: "COMPLETED",
    },
    select: {
      id: true,
      type: true,
      amount: true,
      vat_amount: true,
      pdfUrl: true,
      data: true,
      createdAt: true,
      school: {
        select: {
          name: true,
          commercialRegistration: true,
          vatNumber: true,
          contactNumber: true,
          email: true,
          address: true,
        },
      },
    },
  });
  if (!invoice) {
    throw new StudentInvoiceReminderError("تعذر العثور على الفاتورة المنشأة", 500);
  }

  const pdf = decodeStoredInvoicePdf(invoice.pdfUrl) ?? await renderStoredInvoicePdf({
    id: invoice.id,
    type: invoice.type,
    amount: Number(invoice.amount),
    vatAmount: Number(invoice.vat_amount),
    createdAt: invoice.createdAt,
    data: invoice.data,
    school: invoice.school,
  });

  return {
    invoiceId: invoice.id,
    attachment: {
      filename: `invoice-${invoice.id.slice(0, 12)}.pdf`,
      content: pdf,
      contentType: "application/pdf",
    },
  };
}
