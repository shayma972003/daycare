import { prisma } from "@/lib/prisma";
import { astParts } from "@/lib/datetime";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { deactivateExpiredExpenses } from "@/lib/expense-updater";
import { calculateRecurringAmount } from "@/lib/finance-calculator";

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
  if (type === "annual") return { from: astToUtc(y, 0, 1), to: astToUtc(y, 11, 31, 23, 59, 59, 999) };
  if (type === "semi_annual") {
    if (m <= 5) return { from: astToUtc(y, 0, 1), to: astToUtc(y, 6, 0, 23, 59, 59, 999) };
    return { from: astToUtc(y, 6, 1), to: astToUtc(y, 12, 0, 23, 59, 59, 999) };
  }
  return { from: astToUtc(y, m, 1), to: astToUtc(y, m + 1, 0, 23, 59, 59, 999) };
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

  if (type === "annual") {
    return { from: astToUtc(y - 1, 0, 1), to: astToUtc(y - 1, 11, 31, 23, 59, 59, 999) };
  }

  if (type === "semi_annual") {
    // current.from is either January (H1) or July (H2).
    if (m === 0) return { from: astToUtc(y - 1, 6, 1), to: astToUtc(y - 1, 12, 0, 23, 59, 59, 999) };
    return { from: astToUtc(y, 0, 1), to: astToUtc(y, 6, 0, 23, 59, 59, 999) };
  }

  // Whole previous calendar month. `astToUtc(y, m, 0, …)` is the last instant
  // of the month before m, which is exactly the end we want.
  return { from: astToUtc(y, m - 1, 1), to: astToUtc(y, m, 0, 23, 59, 59, 999) };
}

interface ExpenseLike {
  amount: number;
  type: string;
  start_date: Date;
  stopped_at: Date | null;
  end_date?: Date | null;
}

/** Portion of a (possibly recurring) Expense row that falls within [from, to]. */
export function expenseAmountInPeriod(exp: ExpenseLike, from: Date, to: Date): number {
  const startDate = new Date(exp.start_date);
  if (exp.type === "one_time") {
    return startDate >= from && startDate <= to ? exp.amount : 0;
  }
  let effectiveEnd = to;
  if (exp.stopped_at) effectiveEnd = new Date(Math.min(new Date(exp.stopped_at).getTime(), effectiveEnd.getTime()));
  if (exp.end_date) effectiveEnd = new Date(Math.min(new Date(exp.end_date).getTime(), effectiveEnd.getTime()));
  return calculateRecurringAmount(exp.amount, startDate, effectiveEnd, from, to);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export interface FinancialSummary {
  period: { type: ReportPeriodType; from: string; to: string };

  revenue: {
    total: number;
    monthlyFees: number; // الاشتراكات الشهرية المستحقة على الطلاب النشطين خلال الفترة (حسب تداخل تاريخ الاشتراك مع الفترة)
    registrationFeesCollected: number; // رسوم تسجيل لطلاب مسجّلين خلال الفترة وحالتهم "مدفوع"
    activities: number; // رسوم الفعاليات المقامة خلال الفترة
    lateFees: number; // غرامات تأخير الطلاب (Attendance.lateFee) خلال الفترة
    vatCollected: number; // ضريبة القيمة المضافة (15% تقديري من الرسوم الشهرية المحصَّلة)
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
    paid: number; // ر.س — طلاب بحالة "مدفوع"
    paidWithVat: number; // الإجمالي شامل الضريبة (15%)
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
    paid: number; // نفس القيمة — لا يوجد مصدر منفصل "مدفوع فعليًا" بدون الفواتير
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
  // Every status gets a bucket. The old version knew only three and skipped the
  // rest, so SUSPENDED students — the ones who owe the most — were silently
  // dropped from both the collection breakdown and the amount-due total.
  const buckets: Record<PaymentStatus, { amount: number; count: number }> = {
    PENDING: { amount: 0, count: 0 },
    PAID: { amount: 0, count: 0 },
    LATE: { amount: 0, count: 0 },
    SUSPENDED: { amount: 0, count: 0 },
    CANCELLED: { amount: 0, count: 0 },
  };

  for (const s of students) {
    buckets[s.paymentStatus].amount += monthlyStudentFee + s.registration_fee;
    buckets[s.paymentStatus].count += 1;
  }

  return buckets;
}

/** Sum of active-teacher monthly salaries prorated across each teacher's contract, up to `before`. */
async function getCumulativeSalaryExpense(schoolId: string, before: Date): Promise<number> {
  const teachers = await prisma.teacher.findMany({
    where: { schoolId, isActive: true },
    select: { joinDate: true, monthlySalary: true, enrollmentEndDate: true },
  });
  const dayBefore = new Date(before.getTime() - 1);
  const veryEarly = new Date(0);
  return teachers.reduce((s, t) => {
    const effectiveEnd = t.enrollmentEndDate && t.enrollmentEndDate.getTime() < dayBefore.getTime() ? t.enrollmentEndDate : dayBefore;
    return s + calculateRecurringAmount(t.monthlySalary, new Date(t.joinDate), effectiveEnd, veryEarly, dayBefore);
  }, 0);
}

async function getCumulativeCashPosition(schoolId: string, before: Date): Promise<number> {
  const [paidCycles, paidRegFees, expenses] = await Promise.all([
    prisma.paymentCycle.aggregate({
      where: { school_id: schoolId, status: "PAID", due_date: { lt: before } },
      _sum: { amount: true },
    }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { lt: before } },
      _sum: { registration_fee: true },
    }),
    prisma.expense.findMany({ where: { school_id: schoolId } }),
  ]);

  const veryEarly = new Date(0);
  const manualExpensesTotal = expenses.reduce((s, e) => s + expenseAmountInPeriod(e, veryEarly, new Date(before.getTime() - 1)), 0);
  const salariesExpense = await getCumulativeSalaryExpense(schoolId, before);

  const inflows = (paidCycles._sum.amount ?? 0) + (paidRegFees._sum.registration_fee ?? 0);
  const outflows = salariesExpense + manualExpensesTotal;
  return inflows - outflows;
}

export async function getFinancialSummary(schoolId: string, type: ReportPeriodType): Promise<FinancialSummary> {
  // `deactivateExpiredExpenses` used to run here. Generating a report mutated
  // Expense rows, and two concurrent report requests raced each other writing
  // the same records. It belongs to the nightly job, not to a read path —
  // `expenseAmountInPeriod` already respects `end_date` when summing, so the
  // numbers are the same either way.
  const range = getPeriodRange(type);
  const prevRange = getPreviousPeriodRange(type, range);

  const [school, settings, subscribedStudents, activeTeachers, activitiesInPeriod, expenses, paidRegFeesResult, lateFeesResult] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { vatRegistered: true } }),
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.student.findMany({
      // `enrollmentEndDate: { not: null }` is deliberately gone. Open-ended
      // enrolment is the normal case for a daycare, and requiring an end date
      // silently excluded those children from revenue entirely — the report
      // simply under-reported with no indication why. They are billed to the
      // end of the reporting period instead.
      where: { schoolId, isActive: true, deletedAt: null, enrollment_date: { not: null } },
      select: { name: true, registration_fee: true, enrollment_date: true, enrollmentEndDate: true },
    }),
    prisma.teacher.findMany({
      where: { schoolId, isActive: true },
      select: { id: true, name: true, monthlySalary: true, joinDate: true, enrollmentEndDate: true },
    }),
    prisma.activity.findMany({
      where: { schoolId, startDate: { gte: range.from, lte: range.to } },
      select: { name: true, activityFee: true, childrenCount: true },
    }),
    prisma.expense.findMany({ where: { school_id: schoolId } }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { gte: range.from, lte: range.to } },
      _sum: { registration_fee: true },
    }),
    prisma.attendance.aggregate({
      where: { schoolId, date: { gte: range.from, lte: range.to } },
      _sum: { lateFee: true },
    }),
  ]);

  const monthlyStudentFee = settings?.monthlyStudentFee ?? 0;

  // Subscription revenue: for each active student under contract, count only the months of
  // their enrollment period that overlap the reporting period — not the full contract duration.
  const monthlyFeeItems = subscribedStudents
    .map((st) => {
      // `registration_fee` is a one-off joining fee, counted separately below.
      // Using it as the monthly rate charged it every single month *and* again
      // as a registration fee — the same money twice. The monthly rate is the
      // school's configured fee.
      const amount =
        monthlyStudentFee > 0
          ? calculateRecurringAmount(
              monthlyStudentFee,
              st.enrollment_date!,
              // Open-ended enrolment bills through the end of the period.
              st.enrollmentEndDate ?? range.to,
              range.from,
              range.to
            )
          : 0;
      return { name: st.name, amount };
    })
    .filter((item) => item.amount > 0);

  const lateFeeRevenue = lateFeesResult._sum.lateFee ?? 0;
  const monthlyFeesRevenue = monthlyFeeItems.reduce((s, item) => s + item.amount, 0);
  const activitiesTotal = activitiesInPeriod.reduce((s, a) => s + a.activityFee * a.childrenCount, 0);
  const registrationFeesCollected = paidRegFeesResult._sum.registration_fee ?? 0;

  // VAT is money collected on ZATCA's behalf and owed onward — a liability, not
  // income. It used to be added into revenueTotal, which flowed through to net
  // income and the closing cash balance and overstated both by ~15% of
  // subscription revenue. It is reported separately now.
  //
  // The rate is also only applied to schools that are actually VAT-registered;
  // previously every school had 15% added regardless of `vatRegistered`.
  const vatCollected = school?.vatRegistered ? monthlyFeesRevenue * VAT_RATE : 0;

  const revenueTotal =
    monthlyFeesRevenue + activitiesTotal + registrationFeesCollected + lateFeeRevenue;

  // Teacher salary expense: only count months where the teacher's contract (joinDate through
  // enrollmentEndDate, or ongoing if no end date) overlaps the reporting period.
  const salaryItems = activeTeachers
    .map((t) => {
      const effectiveEnd = t.enrollmentEndDate ?? range.to;
      const amount = calculateRecurringAmount(t.monthlySalary, new Date(t.joinDate), new Date(effectiveEnd), range.from, range.to);
      return { name: t.name, amount };
    })
    .filter((item) => item.amount > 0);
  const salariesExpense = salaryItems.reduce((s, item) => s + item.amount, 0);
  const manualExpenseItems = expenses
    .map((e) => ({ title: e.title, amount: expenseAmountInPeriod(e, range.from, range.to) }))
    .filter((e) => e.amount > 0);
  const manualExpensesTotal = manualExpenseItems.reduce((s, e) => s + e.amount, 0);
  const expensesTotal = salariesExpense + manualExpensesTotal;

  const netIncome = revenueTotal - expensesTotal;

  const billableByStatus = await getStudentBillableByStatus(schoolId, monthlyStudentFee);
  const amountDue =
    billableByStatus.LATE.amount +
    billableByStatus.PENDING.amount +
    // Suspended students still owe — excluding them understated receivables.
    billableByStatus.SUSPENDED.amount;

  // Previous period, for the % comparison only.
  //
  // The two sides must be computed the same way or the percentage is noise. The
  // current period used to include late fees and VAT while the previous one
  // included neither, so growth was overstated by construction — before even
  // accounting for the broken range this compared against.
  const [prevActivities, prevRegFees, prevLateFees] = await Promise.all([
    prisma.activity.findMany({
      where: { schoolId, startDate: { gte: prevRange.from, lte: prevRange.to } },
      select: { activityFee: true, childrenCount: true },
    }),
    prisma.student.aggregate({
      where: { schoolId, isActive: true, paymentStatus: "PAID", registrationDate: { gte: prevRange.from, lte: prevRange.to } },
      _sum: { registration_fee: true },
    }),
    prisma.attendance.aggregate({
      where: { schoolId, date: { gte: prevRange.from, lte: prevRange.to } },
      _sum: { lateFee: true },
    }),
  ]);

  const prevActivitiesTotal = prevActivities.reduce((s, a) => s + a.activityFee * a.childrenCount, 0);
  const prevMonthlyFeesRevenue =
    monthlyStudentFee > 0
      ? subscribedStudents.reduce(
          (s, st) =>
            s +
            calculateRecurringAmount(
              monthlyStudentFee,
              st.enrollment_date!,
              st.enrollmentEndDate ?? prevRange.to,
              prevRange.from,
              prevRange.to
            ),
          0
        )
      : 0;
  const prevSalariesExpense = activeTeachers.reduce((s, t) => {
    const effectiveEnd = t.enrollmentEndDate ?? prevRange.to;
    return s + calculateRecurringAmount(t.monthlySalary, t.joinDate, effectiveEnd, prevRange.from, prevRange.to);
  }, 0);
  const prevManualExpensesTotal = expenses.reduce((s, e) => s + expenseAmountInPeriod(e, prevRange.from, prevRange.to), 0);

  // Same four components as revenueTotal, VAT excluded from both.
  const prevRevenue =
    prevMonthlyFeesRevenue +
    prevActivitiesTotal +
    (prevRegFees._sum.registration_fee ?? 0) +
    (prevLateFees._sum.lateFee ?? 0);
  const prevExpenses = prevSalariesExpense + prevManualExpensesTotal;

  const totalBudgetedSalaries = salariesExpense;

  // Salary invoices actually issued in the period — the only evidence the system
  // holds that a salary was settled.
  const salaryInvoices = await prisma.invoice.aggregate({
    where: { schoolId, type: "TEACHER", createdAt: { gte: range.from, lte: range.to } },
    _sum: { amount: true },
  });
  const salariesPaid = salaryInvoices._sum.amount ?? 0;

  const openingBalance = await getCumulativeCashPosition(schoolId, range.from);
  const closingBalance = openingBalance + revenueTotal - expensesTotal;

  const revenueDetails = monthlyFeeItems.map((item, i) => ({
    id: `subscription-${i}`,
    date: range.to.toISOString(),
    amount: item.amount,
    label: `اشتراك شهري — ${item.name}`,
  }));
  const salaryDetails = salaryItems.map((s, i) => ({
    id: `salary-${i}`,
    date: range.to.toISOString(),
    amount: s.amount,
    label: `راتب — ${s.name}`,
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
      lateFees: lateFeeRevenue,
      vatCollected,
    },
    expenses: {
      total: expensesTotal,
      salaries: salariesExpense,
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
      paidWithVat:
        billableByStatus.PAID.amount * (school?.vatRegistered ? 1 + VAT_RATE : 1),
      late: billableByStatus.LATE.amount,
      pending: billableByStatus.PENDING.amount,
      suspended: billableByStatus.SUSPENDED.amount,
      paidCount: billableByStatus.PAID.count,
      lateCount: billableByStatus.LATE.count,
      pendingCount: billableByStatus.PENDING.count,
      suspendedCount: billableByStatus.SUSPENDED.count,
    },
    salaries: {
      totalBudgeted: totalBudgetedSalaries,
      // `paid` used to be set to the full budget with `remaining: 0`, so the UI
      // reported 100% of salaries as paid no matter what. There is no
      // paid-salary source yet — issued salary invoices are the closest signal,
      // so that is what is reported rather than a fabricated figure.
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
