export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Prisma } from "@/generated/prisma/client";
import { decodeStoredInvoicePdf, renderStoredInvoicePdf } from "@/lib/invoice-pdf";
import { prisma } from "@/lib/prisma";
import { logSafeError } from "@/lib/safe-logger";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { scopedClassIds, studentClassWhere } from "@/lib/student-access-scope";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schoolId = session.user.schoolId;
  const { id } = await params;
  const classIds = scopedClassIds(session);
  const where: Prisma.InvoiceWhereInput = {
    id,
    schoolId,
    generationStatus: "COMPLETED",
    ...(classIds !== null
      ? {
          OR: [
            { student: { is: { schoolId, ...studentClassWhere(session) } } },
            { teacherId: session.teacherId ?? "" },
          ],
        }
      : {}),
  };

  const invoice = await prisma.invoice.findFirst({
    where,
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

  if (!invoice) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const pdf = decodeStoredInvoicePdf(invoice.pdfUrl) ?? await renderStoredInvoicePdf({
      id: invoice.id,
      type: invoice.type,
      amount: Number(invoice.amount),
      vatAmount: Number(invoice.vat_amount),
      createdAt: invoice.createdAt,
      data: invoice.data,
      school: invoice.school,
    });
    const disposition = new URL(request.url).searchParams.get("disposition") === "inline"
      ? "inline"
      : "attachment";
    const filename = `invoice-${invoice.id.slice(0, 12)}.pdf`;

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.byteLength),
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logSafeError("invoice-pdf-download", error);
    return Response.json({ error: "تعذر تجهيز ملف الفاتورة" }, { status: 500 });
  }
}
