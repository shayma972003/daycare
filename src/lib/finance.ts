import { prisma } from "@/lib/prisma";
import { astDayEnd, astParts } from "@/lib/datetime";
import type { PaymentCycleStatus } from "@/generated/prisma/enums";
import { calculateRecurringMoney } from "@/lib/finance-calculator";
import { money, moneyAdd, moneyMultiply, moneyNumber, moneySubtract, type MoneyInput } from "@/lib/money";

export type ReportPeriodType = "monthly" | "semi_annual" | "annual";

/** Saudi VAT. Applied only to schools flagged `vatRegistered`. */
export const VAT_RATE = 0.15;

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

// Semi-annual periods are fixed calendar halves (يناير–يونيو / يوليو–ديسمبر), matching
// how VAT/financial half-year reporting periods are normally defined — not a rolling
// 6-month window ending at the current month.
export function getPeriodRange(type: ReportPeriodType): PeriodRange {
  const { y, m } = astNowParts();
  const todayEnd = new Date(astDayEnd().getTime() - 1);
  if (type === "annual") {
    return {
      from: astToUtc(y, 0, 1),
      to: new Date(Math.min(astToUtc(y, 11, 31, 23, 59, 59, 999).getTime(), todayEnd.getTime())),
    };
  }
  if (type === "semi_annual") {
    const from = m <= 5 ? astToUtc(y, 0, 1) : astToUtc(y, 6, 1);
    const calendarEnd = m <= 5
      ? astToUtc(y, 6, 0, 23, 59, 59, 999)
      : astToUtc(y, 12, 0, 23, 59, 59, 999);
    return { from, to: new Date(Math.min(calendarEnd.getTime(), todayEnd.getTime())) };
  }
  return {
    from: astToUtc(y, m, 1),
    to: new Date(Math.min(astToUtc(y, m + 1, 0, 23, 59, 59, 999).getTime(), todayEnd.getTime())),
  };
}

/**
 * The equal-length period immediately preceding the given range.
 *
 * Read the calendar components in AST. The previous version read them off
 * `current.from` with `getUTC*`, but that instant is the AST-shifted boundary —
 * 21:00 on the *previous* day, month or year — so every branch was wrong:
 *
 *   - annual:      2026 resolved to y=2025, and then returned 2024 — two years back.
 *   - monthly:     July gave y=2026 m=5 d=30, returning 30 May → 31 May: a
 *                  two-day window in the wrong month.
 *   - semi-annual: H1's month read as 11, so the `m === 0` branch was dead and
 *                  H1 compared against the previous year's H1 instead of H2.
 *
 * Everything downstream of this — the growth percentages on the dashboard —
 * was therefore meaningless.
 */
export function getPreviousPeriodRange(type: ReportPeriodType, current: PeriodRange): PeriodRange {
  const { year: y, month: m } = astParts(current.from);
  const elapsed = current.to.getTime() - current.from.getTime();
  const matched = (from: Date, calendarEnd: Date): PeriodRange => ({
    from,
    to: new Date(Math.min(calendarEnd.getTime(), from.getTime() + elapsed)),
  });

  if (type === "annual") {
    return matched(astToUtc(y - 1, 0, 1), astToUtc(y - 1, 11, 31, 23, 59, 59, 999));
  }

  if (type === "semi_annual") {
    // current.from is either January (H1) or July (H2).
    if (m === 0) return matched(astToUtc(y - 1, 6, 1), astToUtc(y - 1, 12, 0, 23, 59, 59, 999));
    return matched(astToUtc(y, 0, 1), astToUtc(y, 6, 0, 23, 59, 59, 999));
  }

  // Whole previous calendar month. `astToUtc(y, m, 0, …)` is the last instant
  // of the month before m, which is exactly the end we want.
  return matched(astToUtc(y, m - 1, 1), astToUtc(y, m, 0, 23, 59, 59, 999));
}

interface ExpenseLike {
  amount: MoneyInput;
  type: string;
  start_date: Date;
  stopped_at: Date | null;
  end_date?: Date | null;
}

/** Portion of a (possibly recurring) Expense row that falls within [from, to]. */
export function expenseAmountInPeriod(exp: ExpenseLike, from: Date, to: Date) {
  const startDate = new Date(exp.start_date);
  if (exp.type === "one_time") {
    return startDate >= from && startDate <= to ? money(exp.amount) : money(0);
  }
  let effectiveEnd = to;
  if (exp.stopped_at) effectiveEnd = new Date(Math.min(new Date(exp.stopped_at).getTime(), effectiveEnd.getTime()));
  if (exp.end_date) effectiveEnd = new Date(Math.min(new Date(exp.end_date).getTime(), effectiveEnd.getTime()));
  return calculateRecurringMoney(exp.amount, startDate, effectiveEnd, from, to);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export interface FinancialSummary {
  period: { type: ReportPeriodType; from: string; to: string };

  revenue: {
    total: number;
    monthlyFees: number; // أقساط الاشتراك المستحقة والمسجلة خلال الفترة
    registrationFeesCollected: number; // رسوم التسجيل المستحقة لطلاب سُجلوا خلال الفترة
    activities: number; // القيمة المتوقعة للفعاليات المقامة خلال الفترة
    lateFees: number; // غرامات تأخير الطلاب (Attendance.lateFee) خلال الفترة
    vatCollected: number; // جزء الضريبة المستخرج من أقساط الاشتراك الشاملة للضريبة
  };
  expenses: {
    total: number;
    salaries: number; // رواتب المعلمين النشطين (حسب العقود) خلال الفترة
    salaryItems: { name: string; amount: number }[];
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
    paid: number; // ر.س — دورات دفع مسددة داخل الفترة
    vatIncluded: number; // جزء الضريبة المستخرج من المبالغ المدفوعة الشاملة للضريبة
    late: number; // ر.س — طلاب بحالة "متأخر"
    pending: number; // ر.س — طلاب بحالة "بانتظار الدفع"
    suspended: number; // ر.س — طلاب موقوفين، كانوا مستبعدين تماماً من التقرير
    paidCount: number;
    lateCount: number;
    pendingCount: number;
    suspendedCount: number;
  };

  salaries: {
    totalBudgeted: number; // رواتب المعلمين النشطين خلال الفترة (حسب العقود)
    invoicesIssued: number; // وثائق صادرة وليست إثبات دفع
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

async function getCycleBillableByStatus(schoolId: string, range: PeriodRange) {
  const cycles = await prisma.paymentCycle.findMany({
    where: { school_id: schoolId, due_date: { gte: range.from, lte: range.to } },
    select: { status: true, amount: true },
  });
  const buckets: Record<PaymentCycleStatus, { amount: ReturnType<typeof money>; count: number }> = {
    PENDING: { amount: money(0), count: 0 },
    PAID: { amount: money(0), count: 0 },
    OVERDUE: { amount: money(0), count: 0 },
    SUSPENDED: { amount: money(0), count: 0 },
    CANCELLED: { amount: money(0), count: 0 },
  };

  for (const cycle of cycles) {
    buckets[cycle.status].amount = moneyAdd(buckets[cycle.status].amount, cycle.amount);
    buckets[cycle.status].count += 1;
  }

  return buckets;
}

async function getCashWindow(schoolId: string, range: PeriodRange) {
  const profile = await prisma.financeProfile.findUnique({ where: { school_id: schoolId } });
  if (!profile?.opening_balance_date) return { openingBalance: money(0), from: range.from };
  const balanceStart = new Date(profile.opening_balance_date.getTime() - AST_OFFSET_MS);
  if (balanceStart > range.to) {
    return { openingBalance: money(0), from: new Date(range.to.getTime() + 1) };
  }
  if (balanceStart >= range.from) {
    return { openingBalance: money(profile.opening_balance), from: balanceStart };
  }
  const [paidCycles, paidExpenses] = await Promise.all([
    prisma.paymentCycle.aggregate({
      where: { school_id: schoolId, status: "PAID", paid_at: { gte: balanceStart, lt: range.from } },
      _sum: { amount: true },
    }),
    prisma.expenseOccurrence.aggregate({
      where: { school_id: schoolId, status: "PAID", paid_at: { gte: balanceStart, lt: range.from } },
      _sum: { amount: true },
    }),
  ]);
  return {
    openingBalance: moneySubtract(
      moneyAdd(profile.opening_balance, paidCycles._sum.amount),
      paidExpenses._sum.amount
    ),
    from: range.from,
  };
}

export async function getFinancialSummary(schoolId: string, type: ReportPeriodType): Promise<FinancialSummary> {
  // `deactivateExpiredExpenses` used to run here. Generating a report mutated
  // Expense rows, and two concurrent report requests raced each other writing
  // the same records. It belongs to the nightly job, not to a read path —
  // `expenseAmountInPeriod` already respects `end_date` when summing, so the
  // numbers are the same either way.
  const range = getPeriodRange(type);
  const prevRange = getPreviousPeriodRange(type, range);

  const [school, paymentCyclesInPeriod, teachersInScope, activitiesInPeriod, expenseOccurrences, registrationFeesResult, lateFeesResult] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { vatRegistered: true } }),
    prisma.paymentCycle.findMany({
      where: { school_id: schoolId, due_date: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, due_date: true, student: { select: { name: true } } },
    }),
    prisma.teacher.findMany({
      where: {
        schoolId,
        joinDate: { lte: range.to },
        OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: range.from } }],
      },
      select: { id: true, name: true, monthlySalary: true, joinDate: true, enrollmentEndDate: true },
    }),
    prisma.activity.findMany({
      where: { schoolId, startDate: { gte: range.from, lte: range.to } },
      select: { name: true, activityFee: true, childrenCount: true },
    }),
    prisma.expenseOccurrence.findMany({
      where: { school_id: schoolId, due_date: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, due_date: true, expense: { select: { title: true } } },
    }),
    prisma.student.aggregate({
      where: { schoolId, registrationDate: { gte: range.from, lte: range.to } },
      _sum: { registration_fee: true },
    }),
    prisma.attendance.aggregate({
      where: { schoolId, date: { gte: range.from, lte: range.to } },
      _sum: { lateFee: true },
    }),
  ]);

  // Subscription revenue comes from the persisted schedule, not a second
  // projection from the student's current product. Changing terms can therefore
  // never rewrite what an earlier report says was due.
  const monthlyFeeItems = paymentCyclesInPeriod.map((cycle) => ({
    id: cycle.id,
    name: cycle.student.name,
    date: cycle.due_date,
    amount: money(cycle.amount),
  }));

  const lateFeeRevenue = lateFeesResult._sum.lateFee ?? 0;
  const monthlyFeesRevenue = monthlyFeeItems.reduce((s, item) => moneyAdd(s, item.amount), money(0));
  const activitiesTotal = activitiesInPeriod.reduce((s, a) => moneyAdd(s, moneyMultiply(a.activityFee, a.childrenCount)), money(0));
  const registrationFeesCollected = registrationFeesResult._sum.registration_fee ?? 0;

  // Subscription prices are VAT-inclusive (the invoice path uses the same
  // contract). Extract 15/115 from billed fees; adding 15% here would disagree
  // with the invoice and overstate the liability.
  const vatCollected = school?.vatRegistered
    ? money(monthlyFeesRevenue).mul(VAT_RATE).div(1 + VAT_RATE).toDecimalPlaces(2)
    : money(0);

  const revenueTotal = moneyAdd(monthlyFeesRevenue, activitiesTotal, registrationFeesCollected, lateFeeRevenue);

  // Teacher salary expense: only count months where the teacher's contract (joinDate through
  // enrollmentEndDate, or ongoing if no end date) overlaps the reporting period.
  const salaryItems = teachersInScope
    .map((t) => {
      const effectiveEnd = t.enrollmentEndDate ?? range.to;
      const amount = calculateRecurringMoney(t.monthlySalary, new Date(t.joinDate), new Date(effectiveEnd), range.from, range.to);
      return { name: t.name, amount };
    })
    .filter((item) => item.amount.greaterThan(0));
  const salariesExpense = salaryItems.reduce((s, item) => moneyAdd(s, item.amount), money(0));
  const manualExpenseMap = new Map<string, ReturnType<typeof money>>();
  for (const occurrence of expenseOccurrences) {
    manualExpenseMap.set(
      occurrence.expense.title,
      moneyAdd(manualExpenseMap.get(occurrence.expense.title), occurrence.amount)
    );
  }
  const manualExpenseItems = [...manualExpenseMap].map(([title, amount]) => ({ title, amount }));
  const manualExpensesTotal = manualExpenseItems.reduce((s, e) => moneyAdd(s, e.amount), money(0));
  const expensesTotal = moneyAdd(salariesExpense, manualExpensesTotal);

  const netIncome = moneySubtract(revenueTotal, expensesTotal);

  const billableByStatus = await getCycleBillableByStatus(schoolId, range);
  const amountDue = moneyAdd(
    billableByStatus.OVERDUE.amount,
    billableByStatus.PENDING.amount,
    // Suspended students still owe — excluding them understated receivables.
    billableByStatus.SUSPENDED.amount);

  // Previous period, for the % comparison only.
  //
  // The two sides must be computed the same way or the percentage is noise. The
  // current period used to include late fees and VAT while the previous one
  // included neither, so growth was overstated by construction — before even
  // accounting for the broken range this compared against.
  const [prevActivities, prevRegFees, prevLateFees, prevPaymentCycles, prevTeachers, prevExpenseOccurrences] = await Promise.all([
    prisma.activity.findMany({
      where: { schoolId, startDate: { gte: prevRange.from, lte: prevRange.to } },
      select: { activityFee: true, childrenCount: true },
    }),
    prisma.student.aggregate({
      where: { schoolId, registrationDate: { gte: prevRange.from, lte: prevRange.to } },
      _sum: { registration_fee: true },
    }),
    prisma.attendance.aggregate({
      where: { schoolId, date: { gte: prevRange.from, lte: prevRange.to } },
      _sum: { lateFee: true },
    }),
    prisma.paymentCycle.findMany({
      where: { school_id: schoolId, due_date: { gte: prevRange.from, lte: prevRange.to }, status: { not: "CANCELLED" } },
      select: { amount: true },
    }),
    prisma.teacher.findMany({
      where: {
        schoolId,
        joinDate: { lte: prevRange.to },
        OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: prevRange.from } }],
      },
      select: { monthlySalary: true, joinDate: true, enrollmentEndDate: true },
    }),
    prisma.expenseOccurrence.findMany({
      where: { school_id: schoolId, due_date: { gte: prevRange.from, lte: prevRange.to }, status: { not: "CANCELLED" } },
      select: { amount: true },
    }),
  ]);

  const prevActivitiesTotal = prevActivities.reduce((s, a) => moneyAdd(s, moneyMultiply(a.activityFee, a.childrenCount)), money(0));
  const prevMonthlyFeesRevenue = prevPaymentCycles.reduce((sum, cycle) => moneyAdd(sum, cycle.amount), money(0));
  const prevSalariesExpense = prevTeachers.reduce((s, t) => {
    const effectiveEnd = t.enrollmentEndDate ?? prevRange.to;
    return moneyAdd(s, calculateRecurringMoney(t.monthlySalary, t.joinDate, effectiveEnd, prevRange.from, prevRange.to));
  }, money(0));
  const prevManualExpensesTotal = prevExpenseOccurrences.reduce((sum, occurrence) => moneyAdd(sum, occurrence.amount), money(0));

  // Same four components as revenueTotal, VAT excluded from both.
  const prevRevenue = moneyAdd(prevMonthlyFeesRevenue, prevActivitiesTotal, prevRegFees._sum.registration_fee, prevLateFees._sum.lateFee);
  const prevExpenses = moneyAdd(prevSalariesExpense, prevManualExpensesTotal);

  const totalBudgetedSalaries = salariesExpense;

  // Salary invoices issued in the period. Issuance is not treated as proof that
  // the salary was paid; the schema does not currently store salary settlement.
  const salaryInvoices = await prisma.invoice.aggregate({
    where: { schoolId, type: "TEACHER", generationStatus: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
    _sum: { amount: true },
  });
  const salaryInvoicesIssued = salaryInvoices._sum.amount ?? 0;

  const cashWindow = await getCashWindow(schoolId, range);
  const [cashInflowsResult, cashOutflowsResult] = cashWindow.from <= range.to
    ? await Promise.all([
        prisma.paymentCycle.aggregate({
          where: { school_id: schoolId, status: "PAID", paid_at: { gte: cashWindow.from, lte: range.to } },
          _sum: { amount: true },
        }),
        prisma.expenseOccurrence.aggregate({
          where: { school_id: schoolId, status: "PAID", paid_at: { gte: cashWindow.from, lte: range.to } },
          _sum: { amount: true },
        }),
      ])
    : [{ _sum: { amount: null } }, { _sum: { amount: null } }];
  const openingBalance = cashWindow.openingBalance;
  const cashInflows = money(cashInflowsResult._sum.amount);
  const cashOutflows = money(cashOutflowsResult._sum.amount);
  const closingBalance = moneySubtract(moneyAdd(openingBalance, cashInflows), cashOutflows);

  const revenueDetails = monthlyFeeItems.map((item) => ({
    id: item.id,
    date: item.date.toISOString(),
    amount: item.amount,
    label: `استحقاق اشتراك — ${item.name}`,
  }));
  const salaryDetails = salaryItems.map((s, i) => ({
    id: `salary-${i}`,
    date: range.to.toISOString(),
    amount: s.amount,
    label: `راتب — ${s.name}`,
  }));
  const manualExpenseDetails = expenseOccurrences.map((occurrence) => ({
    id: occurrence.id,
    date: occurrence.due_date.toISOString(),
    amount: money(occurrence.amount),
    label: occurrence.expense.title,
  }));

  const asNumber = moneyNumber;

  return {
    period: { type, from: range.from.toISOString(), to: range.to.toISOString() },
    revenue: {
      total: asNumber(revenueTotal),
      monthlyFees: asNumber(monthlyFeesRevenue),
      registrationFeesCollected: asNumber(registrationFeesCollected),
      activities: asNumber(activitiesTotal),
      lateFees: asNumber(lateFeeRevenue),
      vatCollected: asNumber(vatCollected),
    },
    expenses: {
      total: asNumber(expensesTotal),
      salaries: asNumber(salariesExpense),
      salaryItems: salaryItems.map((item) => ({ ...item, amount: asNumber(item.amount) })),
      manual: manualExpenseItems.map((item) => ({ ...item, amount: asNumber(item.amount) })),
      manualTotal: asNumber(manualExpensesTotal),
    },
    netIncome: asNumber(netIncome),
    amountDue: asNumber(amountDue),
    comparison: {
      revenuePct: pctChange(asNumber(revenueTotal), asNumber(prevRevenue)),
      expensesPct: pctChange(asNumber(expensesTotal), asNumber(prevExpenses)),
    },
    collection: {
      paid: asNumber(billableByStatus.PAID.amount),
      vatIncluded: asNumber(school?.vatRegistered
        ? money(billableByStatus.PAID.amount).mul(VAT_RATE).div(1 + VAT_RATE).toDecimalPlaces(2)
        : money(0)),
      late: asNumber(billableByStatus.OVERDUE.amount),
      pending: asNumber(billableByStatus.PENDING.amount),
      suspended: asNumber(billableByStatus.SUSPENDED.amount),
      paidCount: billableByStatus.PAID.count,
      lateCount: billableByStatus.OVERDUE.count,
      pendingCount: billableByStatus.PENDING.count,
      suspendedCount: billableByStatus.SUSPENDED.count,
    },
    salaries: {
      totalBudgeted: asNumber(totalBudgetedSalaries),
      invoicesIssued: asNumber(salaryInvoicesIssued),
    },
    cashFlow: {
      openingBalance: asNumber(openingBalance),
      inflows: asNumber(cashInflows),
      outflows: asNumber(cashOutflows),
      closingBalance: asNumber(closingBalance),
    },
    details: {
      revenue: revenueDetails.map((item) => ({ ...item, amount: asNumber(item.amount) })),
      salaries: salaryDetails.map((item) => ({ ...item, amount: asNumber(item.amount) })),
      manualExpenses: manualExpenseDetails.map((item) => ({ ...item, amount: asNumber(item.amount) })),
    },
  };
}
