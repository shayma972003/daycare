import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly, astParts } from "@/lib/datetime";

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

  const now = new Date();
  const issueDate = now.toISOString().split("T")[0];

  // Lateness for *this month only*. `teacher.lateHours` is a cumulative total
  // that is never reset, so using it meant every monthly salary invoice
  // re-deducted the teacher's entire history of lateness, over and over.
  const { year, month } = astParts(now);
  const monthStart = astDateOnly(new Date(Date.UTC(year, month, 1)));
  const monthEnd = astDateOnly(new Date(Date.UTC(year, month + 1, 0)));

  const monthLateness = await prisma.teacherAttendance.aggregate({
    where: {
      teacherId: id,
      schoolId,
      compensated: false,
      date: { gte: monthStart, lte: monthEnd },
    },
    _sum: { lateMinutes: true },
  });

  const lateHours = (monthLateness._sum.lateMinutes ?? 0) / 60;
  const lateDeduction = lateHours * teacher.lateDeductionRate;
  const netSalary = Math.max(0, teacher.monthlySalary - lateDeduction);

  const invoiceData = {
    teacherName: teacher.name,
    monthlySalary: teacher.monthlySalary,
    lateHours,
    lateDeductionRate: teacher.lateDeductionRate,
    lateDeduction,
    netSalary,
    issueDate,
    periodFrom: monthStart.toISOString().slice(0, 10),
    periodTo: monthEnd.toISOString().slice(0, 10),
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
