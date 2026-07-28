import { prisma } from "@/lib/prisma";

export type ReportPeriodType = "monthly" | "semi_annual" | "annual";

const AST_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Builds a UTC Date instant that corresponds to the given wall-clock time in AST (UTC+3). */
function astToUtc(y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m, d, h, mi, s, ms) - AST_OFFSET_MS);
}

/** Current date/time's Y/M/D wall-clock components as seen in AST (UTC+3), regardless of host timezone. */
function astNowParts(): { y: number; m: number; d: number } {
  const shifted = new Date(Date.now() + AST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

export interface PeriodRange {
  from: Date;
  to: Date;
}

export function getPeriodRange(type: ReportPeriodType): PeriodRange {
  const { y, m } = astNowParts();
  if (type === "annual") return { from: astToUtc(y, 0, 1), to: astToUtc(y, 11, 31, 23, 59, 59, 999) };
  if (type === "semi_annual") return { from: astToUtc(y, m - 5, 1), to: astToUtc(y, m + 1, 0, 23, 59, 59, 999) };
  return { from: astToUtc(y, m, 1), to: astToUtc(y, m + 1, 0, 23, 59, 59, 999) };
}

/** The equal-length period immediately preceding the given range, for period-over-period comparisons. */
export function getPreviousPeriodRange(type: ReportPeriodType, current: PeriodRange): PeriodRange {
  const y = current.from.getUTCFullYear();
  const m = current.from.getUTCMonth();
  const d = current.from.getUTCDate();
  if (type === "annual") return { from: astToUtc(y - 1, 0, 1), to: astToUtc(y - 1, 11, 31, 23, 59, 59, 999) };
  if (type === "semi_annual") return { from: astToUtc(y, m - 6, 1), to: astToUtc(y, m, 0, 23, 59, 59, 999) };
  return { from: astToUtc(y, m - 1, d), to: astToUtc(y, m, 0, 23, 59, 59, 999) };
}

interface ExpenseLike {
  amount: number;
  type: string;
  start_date: Date;
  stopped_at: Date | null;
}

function countOverlappingMonths(from: Date, to: Date): number {
  if (from > to) return 0;
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
}

/** Portion of a (possibly recurring) Expense row that falls within [from, to]. */
export function expenseAmountInPeriod(exp: ExpenseLike, from: Date, to: Date): number {
  const startDate = new Date(exp.start_date);
  if (exp.type === "one_time") {
    return startDate >= from && startDate <= to ? exp.amount : 0;
  }
  const effectiveEnd = exp.stopped_at ? new Date(Math.min(new Date(exp.stopped_at).getTime(), to.getTime())) : to;
  if (startDate <= effectiveEnd) {
    const months = countOverlappingMonths(new Date(Math.max(startDate.getTime(), from.getTime())), effectiveEnd);
    return exp.amount * months;
  }
  return 0;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export interface FinancialSummary {
  period: { type: ReportPeriodType; from: string; to: string };

  revenue: {
    total: number;
    monthlyFees: number; // مبالغ فواتير الطلاب (رسوم شهرية + غرامات تأخير)
    registrationFeesCollected: number; // رسوم تسجيل لطلاب مسجّلين خلال الفترة وحالتهم "مدفوع"
    activities: number; // إجمالي فواتير الأنشطة ضمن فواتير الطلاب
  };
  expenses: {
    total: number;
    salaries: number; // رواتب مدفوعة فعلياً خلال الفترة
    salaryItems: { name: string; amount: number }[]; // كل عملية دفع راتب لمعلم خلال الفترة
    manual: { title: string; amount: number }[]; // مصاريف مضافة يدويًا من قسم المصاريف
    manualTotal: number;
  };
  netIncome: number;
  amountDue: number; // مبالغ مستحقة غير محصّلة (طلاب بحالة متأخر/بانتظار الدفع)

  comparison: {
    revenuePct: number | null;
    expensesPct: number | null;
  };

  collection: {
    paid: number; // ر.س — طلاب بحالة "مدفوع"
    late: number; // ر.س — طلاب بحالة "متأخر"
    pending: number; // ر.س — طلاب بحالة "بانتظار الدفع"
    paidCount: number;
    lateCount: number;
    pendingCount: number;
  };

  salaries: {
    totalBudgeted: number; // إجمالي رواتب المعلمين النشطين المتعاقد عليها
    paid: number; // المصروف فعليًا خلال الفترة
    remaining: number;
  };

  cashFlow: {
    openingBalance: number;
    inflows: number;
    outflows: number;
    closingBalance: number;
  };

  details: {
    revenue: { id: string; date: string; amount: number; label: string }[];
    salaries: { id: string; date: string; amount: number; label: string }[];
    manualExpenses: { id: string; date: string; amount: number; label: string }[];
  };
}

/** Per-student billable amount used for "owed"/"collection" money figures (Settings.monthlyStudentFee + registration_fee). */
async function getStudentBillableByStatus(schoolId: string, monthlyStudentFee: number) {
  const students = await prisma.student.findMany({
    where: { schoolId, isActive: true },
    select: { paymentStatus: true, registration_fee: true },
  });
  const buckets: Record<string, { amount: number; count: number }> = {
    PAID: { amount: 0, count: 0 },
    LATE: { amount: 0, count: 0 },
    "بانتظار الدفع": { amount: 0, count: 0 },
  };
  for (const s of students) {
    if (!(s.paymentStatus in buckets)) continue;
    buckets[s.paymentStatus].amount += monthlyStudentFee + s.registration_fee;
    buckets[s.paymentStatus].count += 1;
  }
  return buckets;
}

async function getCumulativeCashPosition(schoolId: string, before: Date): Promise<number> {
  const [studentInvoices, teacherInvoices, paidRegFees, expenses] = await Promise.all([
    prisma.invoice.aggregate({ where: { schoolId, type: "STUDENT", createdAt: { lt: before } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { schoolId, type: "TEACHER", createdAt: { lt: before } }, _sum: { amount: true } }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { lt: before } },
      _sum: { registration_fee: true },
    }),
    prisma.expense.findMany({ where: { school_id: schoolId } }),
  ]);

  const veryEarly = new Date(0);
  const manualExpensesTotal = expenses.reduce((s, e) => s + expenseAmountInPeriod(e, veryEarly, new Date(before.getTime() - 1)), 0);

  const inflows = (studentInvoices._sum.amount ?? 0) + (paidRegFees._sum.registration_fee ?? 0);
  const outflows = (teacherInvoices._sum.amount ?? 0) + manualExpensesTotal;
  return inflows - outflows;
}

export async function getFinancialSummary(schoolId: string, type: ReportPeriodType): Promise<FinancialSummary> {
  const range = getPeriodRange(type);
  const prevRange = getPreviousPeriodRange(type, range);

  const [settings, studentInvoices, teacherInvoices, expenses, paidRegFeesResult] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.invoice.findMany({
      where: { schoolId, type: "STUDENT", createdAt: { gte: range.from, lte: range.to } },
      include: { student: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { schoolId, type: "TEACHER", createdAt: { gte: range.from, lte: range.to } },
      include: { teacher: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.expense.findMany({ where: { school_id: schoolId } }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { gte: range.from, lte: range.to } },
      _sum: { registration_fee: true },
    }),
  ]);

  const activitiesTotal = studentInvoices.reduce((s, inv) => {
    const data = inv.data as { activitiesTotal?: number } | null;
    return s + (data?.activitiesTotal ?? 0);
  }, 0);
  const studentInvoicesTotal = studentInvoices.reduce((s, inv) => s + inv.amount, 0);
  const monthlyFeesRevenue = studentInvoicesTotal - activitiesTotal;
  const registrationFeesCollected = paidRegFeesResult._sum.registration_fee ?? 0;
  const revenueTotal = monthlyFeesRevenue + activitiesTotal + registrationFeesCollected;

  const salaryItems = teacherInvoices.map((inv) => ({ name: inv.teacher?.name ?? "معلم", amount: inv.amount }));
  const salariesPaid = teacherInvoices.reduce((s, inv) => s + inv.amount, 0);
  const manualExpenseItems = expenses
    .map((e) => ({ title: e.title, amount: expenseAmountInPeriod(e, range.from, range.to) }))
    .filter((e) => e.amount > 0);
  const manualExpensesTotal = manualExpenseItems.reduce((s, e) => s + e.amount, 0);
  const expensesTotal = salariesPaid + manualExpensesTotal;

  const netIncome = revenueTotal - expensesTotal;

  const monthlyStudentFee = settings?.monthlyStudentFee ?? 0;
  const billableByStatus = await getStudentBillableByStatus(schoolId, monthlyStudentFee);
  const amountDue = billableByStatus.LATE.amount + billableByStatus["بانتظار الدفع"].amount;

  // Previous period (for % comparison only — same shape, computed inline to avoid recursion cost)
  const [prevStudentInvoices, prevTeacherInvoices, prevRegFees] = await Promise.all([
    prisma.invoice.aggregate({ where: { schoolId, type: "STUDENT", createdAt: { gte: prevRange.from, lte: prevRange.to } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { schoolId, type: "TEACHER", createdAt: { gte: prevRange.from, lte: prevRange.to } }, _sum: { amount: true } }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { gte: prevRange.from, lte: prevRange.to } },
      _sum: { registration_fee: true },
    }),
  ]);
  const prevManualExpensesTotal = expenses.reduce((s, e) => s + expenseAmountInPeriod(e, prevRange.from, prevRange.to), 0);
  const prevRevenue = (prevStudentInvoices._sum.amount ?? 0) + (prevRegFees._sum.registration_fee ?? 0);
  const prevExpenses = (prevTeacherInvoices._sum.amount ?? 0) + prevManualExpensesTotal;

  const teacherSalaryTotals = await prisma.teacher.aggregate({ where: { schoolId, isActive: true }, _sum: { monthlySalary: true } });
  const totalBudgetedSalaries = teacherSalaryTotals._sum.monthlySalary ?? 0;

  const openingBalance = await getCumulativeCashPosition(schoolId, range.from);
  const closingBalance = openingBalance + revenueTotal - expensesTotal;

  const revenueDetails = studentInvoices.map((inv) => ({
    id: inv.id,
    date: inv.createdAt.toISOString(),
    amount: inv.amount,
    label: inv.student?.name ? `فاتورة رسوم — ${inv.student.name}` : "فاتورة رسوم",
  }));
  const salaryDetails = teacherInvoices.map((inv) => ({
    id: inv.id,
    date: inv.createdAt.toISOString(),
    amount: inv.amount,
    label: inv.teacher?.name ? `راتب — ${inv.teacher.name}` : "راتب معلم",
  }));
  const manualExpenseDetails = expenses
    .map((e) => ({ id: e.id, date: e.start_date.toISOString(), amount: expenseAmountInPeriod(e, range.from, range.to), label: e.title }))
    .filter((e) => e.amount > 0);

  return {
    period: { type, from: range.from.toISOString(), to: range.to.toISOString() },
    revenue: {
      total: revenueTotal,
      monthlyFees: monthlyFeesRevenue,
      registrationFeesCollected,
      activities: activitiesTotal,
    },
    expenses: {
      total: expensesTotal,
      salaries: salariesPaid,
      salaryItems,
      manual: manualExpenseItems,
      manualTotal: manualExpensesTotal,
    },
    netIncome,
    amountDue,
    comparison: {
      revenuePct: pctChange(revenueTotal, prevRevenue),
      expensesPct: pctChange(expensesTotal, prevExpenses),
    },
    collection: {
      paid: billableByStatus.PAID.amount,
      late: billableByStatus.LATE.amount,
      pending: billableByStatus["بانتظار الدفع"].amount,
      paidCount: billableByStatus.PAID.count,
      lateCount: billableByStatus.LATE.count,
      pendingCount: billableByStatus["بانتظار الدفع"].count,
    },
    salaries: {
      totalBudgeted: totalBudgetedSalaries,
      paid: salariesPaid,
      remaining: Math.max(0, totalBudgetedSalaries - salariesPaid),
    },
    cashFlow: {
      openingBalance,
      inflows: revenueTotal,
      outflows: expensesTotal,
      closingBalance,
    },
    details: {
      revenue: revenueDetails,
      salaries: salaryDetails,
      manualExpenses: manualExpenseDetails,
    },
  };
}
