import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const settings = await prisma.settings.findUnique({ where: { schoolId } });
  const monthlyStudentFee = settings?.monthlyStudentFee ?? 0;

  const issueDate = new Date().toISOString().split("T")[0];

  const invoiceData = {
    studentName: student.name,
    guardianName: student.guardian?.name ?? "",
    phone: student.guardian?.phone1 ?? student.guardian?.phone2 ?? "",
    class: student.class?.name ?? "",
    period: student.period,
    monthlyFee: monthlyStudentFee,
    issueDate,
  };

  const invoice = await prisma.invoice.create({
    data: {
      schoolId,
      type: "STUDENT",
      studentId: id,
      amount: monthlyStudentFee,
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
