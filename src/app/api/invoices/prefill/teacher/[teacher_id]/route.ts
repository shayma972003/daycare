import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ teacher_id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { teacher_id } = await params;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [school, teacher, invoiceCount, lateResult] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.teacher.findFirst({
      where: { id: teacher_id, schoolId, deletedAt: null },
      include: { classes: { take: 1 } },
    }),
    prisma.invoice.count({ where: { schoolId } }),
    prisma.teacherAttendance.aggregate({
      where: {
        teacherId: teacher_id,
        schoolId,
        date: { gte: monthStart, lte: now },
      },
      _sum: { lateMinutes: true },
    }),
  ]);

  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const invoiceNumber = "INV-" + String(invoiceCount + 1).padStart(4, "0");

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const issueDate = `${dd}/${mm}/${yyyy}`;

  const totalLateMinutes = lateResult._sum.lateMinutes ?? 0;
  const totalLateHoursThisMonth = Math.round((totalLateMinutes / 60) * 100) / 100;

  return Response.json({
    school: {
      name: school?.name ?? "",
      logoUrl: school?.logoUrl ?? null,
      commercialRegistration: school?.commercialRegistration ?? null,
      vatNumber: school?.vatNumber ?? null,
      contactNumber: school?.contactNumber ?? null,
      email: school?.email ?? null,
      address: school?.address ?? null,
    },
    teacher: {
      id: teacher.id,
      full_name: teacher.name,
      phone_1: teacher.phone1 ?? null,
      email: teacher.email ?? null,
      payment_method: teacher.paymentMethod,
      monthly_salary: teacher.monthlySalary ?? 0,
      late_deduction_rate: teacher.lateDeductionRate ?? 0,
      total_late_hours_this_month: totalLateHoursThisMonth,
      class_name: teacher.classes?.[0]?.name ?? null,
    },
    invoiceNumber,
    issueDate,
  });
}
