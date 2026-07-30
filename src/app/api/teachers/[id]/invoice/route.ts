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

  const teacher = await prisma.teacher.findFirst({
    where: { id, schoolId, deletedAt: null },
  });

  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const issueDate = new Date().toISOString().split("T")[0];
  const lateDeduction = teacher.lateHours * teacher.lateDeductionRate;
  const netSalary = teacher.monthlySalary - lateDeduction;

  const invoiceData = {
    teacherName: teacher.name,
    monthlySalary: teacher.monthlySalary,
    lateHours: teacher.lateHours,
    lateDeductionRate: teacher.lateDeductionRate,
    lateDeduction,
    netSalary,
    issueDate,
  };

  const invoice = await prisma.invoice.create({
    data: {
      schoolId,
      type: "TEACHER",
      teacherId: id,
      amount: netSalary,
      data: invoiceData,
    },
    include: { teacher: true },
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
