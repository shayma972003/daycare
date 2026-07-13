import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  // 1. Financial summary
  const [revenueResult, expense, salariesResult, regFeeResult] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        schoolId,
        type: "STUDENT",
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amount: true },
    }),
    prisma.monthlyExpense.findUnique({
      where: { schoolId_month_year: { schoolId, month, year } },
    }),
    prisma.teacher.aggregate({
      where: { schoolId },
      _sum: { monthlySalary: true },
    }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, deletedAt: null },
      _sum: { registration_fee: true },
    }),
  ]);

  const revenue = revenueResult._sum.amount ?? 0;
  const totalRegistrationFees = regFeeResult._sum.registration_fee ?? 0;
  const salaries = salariesResult._sum.monthlySalary ?? 0;
  const expenseBreakdown = {
    rent: expense?.rent ?? 0,
    maintenance: expense?.maintenance ?? 0,
    materials: expense?.materials ?? 0,
    misc: expense?.misc ?? 0,
    salaries,
  };
  const totalExpenses =
    expenseBreakdown.rent +
    expenseBreakdown.maintenance +
    expenseBreakdown.materials +
    expenseBreakdown.misc +
    salaries;
  const netProfit = revenue - totalExpenses;

  // 2. Payment status breakdown
  const paymentStatusGroups = await prisma.student.groupBy({
    by: ["paymentStatus"],
    where: { schoolId, deletedAt: null },
    _count: { paymentStatus: true },
  });

  const paymentStatusBreakdown: Record<string, number> = {
    PAID: 0, LATE: 0, CANCELLED: 0, SUSPENDED: 0, "بانتظار الدفع": 0,
  };
  for (const g of paymentStatusGroups) {
    paymentStatusBreakdown[g.paymentStatus] = g._count.paymentStatus;
  }

  // 3. Enrollment trend — last 12 months
  const enrollmentTrend: Array<{ month: number; year: number; boys: number; girls: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const [boys, girls] = await Promise.all([
      prisma.student.count({
        where: { schoolId, gender: "MALE", createdAt: { gte: start, lt: end }, deletedAt: null },
      }),
      prisma.student.count({
        where: { schoolId, gender: "FEMALE", createdAt: { gte: start, lt: end }, deletedAt: null },
      }),
    ]);

    enrollmentTrend.push({ month: m, year: y, boys, girls });
  }

  // 4. Attendance by class
  const classes = await prisma.class.findMany({
    where: { schoolId, deletedAt: null },
    include: {
      students: { select: { id: true }, where: { deletedAt: null } },
    },
  });

  const attendanceByClass: Array<{ className: string; attendanceRate: number }> = [];
  for (const cls of classes) {
    const studentIds = cls.students.map((s) => s.id);
    if (studentIds.length === 0) {
      attendanceByClass.push({ className: cls.name, attendanceRate: 0 });
      continue;
    }

    const totalPossible = await prisma.attendance.count({
      where: {
        classId: cls.id,
        date: { gte: monthStart, lt: monthEnd },
      },
    });

    const present = await prisma.attendance.count({
      where: {
        classId: cls.id,
        date: { gte: monthStart, lt: monthEnd },
        checkinAt: { not: null },
      },
    });

    const rate = totalPossible > 0 ? Math.round((present / totalPossible) * 100) : 0;
    attendanceByClass.push({ className: cls.name, attendanceRate: rate });
  }

  // 5. Late summary
  const [lateHoursResult, lateFeesResult, topStudents] = await Promise.all([
    prisma.student.aggregate({
      where: { schoolId, deletedAt: null },
      _sum: { lateHours: true },
    }),
    prisma.attendance.aggregate({
      where: {
        schoolId,
        date: { gte: monthStart, lt: monthEnd },
      },
      _sum: { lateFee: true },
    }),
    prisma.student.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { lateHours: "desc" },
      take: 5,
      select: { name: true, lateHours: true },
    }),
  ]);

  return Response.json({
    financialSummary: {
      revenue,
      expenses: totalExpenses,
      netProfit,
      totalRegistrationFees,
    },
    paymentStatusBreakdown,
    expenseBreakdown,
    enrollmentTrend,
    attendanceByClass,
    lateSummary: {
      totalLateHours: lateHoursResult._sum.lateHours ?? 0,
      totalLateFees: lateFeesResult._sum.lateFee ?? 0,
      topStudents,
    },
  }, { status: 200 });
}
