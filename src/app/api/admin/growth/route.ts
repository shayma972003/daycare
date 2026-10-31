import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { addUtcMonths, forecastTrend, monthKey, percentageChange } from "@/lib/admin-growth";
import { moneyNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const ALLOWED_MONTHS = new Set([6, 12, 18]);

function selectedMonths(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("months") ?? 12);
  return ALLOWED_MONTHS.has(raw) ? raw : 12;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("ar-SA", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const months = selectedMonths(request);
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const historyStart = addUtcMonths(currentMonth, -(months - 1));

  const [newSchools, newStudents, newTeachers, payments, currentSchools] = await Promise.all([
    prisma.school.findMany({
      where: { createdAt: { gte: historyStart } },
      select: { createdAt: true },
    }),
    prisma.student.findMany({
      where: { createdAt: { gte: historyStart } },
      select: { createdAt: true },
    }),
    prisma.teacher.findMany({
      where: { createdAt: { gte: historyStart } },
      select: { createdAt: true },
    }),
    prisma.schoolSubscriptionPayment.findMany({
      where: { created_at: { gte: historyStart }, currency: "SAR" },
      select: { status: true, amount: true, created_at: true, paid_at: true },
    }),
    prisma.school.findMany({
      where: { subscription_status: { in: ["active", "trial"] } },
      select: {
        subscription_status: true,
        subscription_plan: {
          select: { name: true, price: true, billing_interval: true },
        },
        _count: { select: { students: { where: { isActive: true, deletedAt: null } } } },
      },
    }),
  ]);

  const series = Array.from({ length: months }, (_value, index) => {
    const date = addUtcMonths(historyStart, index);
    return {
      key: monthKey(date),
      label: monthLabel(date),
      partial: index === months - 1,
      newSchools: 0,
      newStudents: 0,
      newTeachers: 0,
      revenue: 0,
      paidPayments: 0,
      failedPayments: 0,
    };
  });
  const byMonth = new Map(series.map((item) => [item.key, item]));

  newSchools.forEach((row) => {
    const bucket = byMonth.get(monthKey(row.createdAt));
    if (bucket) bucket.newSchools += 1;
  });
  newStudents.forEach((row) => {
    const bucket = byMonth.get(monthKey(row.createdAt));
    if (bucket) bucket.newStudents += 1;
  });
  newTeachers.forEach((row) => {
    const bucket = byMonth.get(monthKey(row.createdAt));
    if (bucket) bucket.newTeachers += 1;
  });
  payments.forEach((payment) => {
    const effectiveDate = payment.paid_at ?? payment.created_at;
    const bucket = byMonth.get(monthKey(effectiveDate));
    if (!bucket) return;
    if (payment.status === "PAID") {
      bucket.revenue += moneyNumber(payment.amount);
      bucket.paidPayments += 1;
    } else if (payment.status === "FAILED") {
      bucket.failedPayments += 1;
    }
  });
  series.forEach((item) => {
    item.revenue = Math.round(item.revenue * 100) / 100;
  });

  let mrr = 0;
  let paidSchools = 0;
  let trialSchools = 0;
  const planMap = new Map<string, { schools: number; students: number; mrr: number }>();
  currentSchools.forEach((school) => {
    const isTrial = school.subscription_status === "trial";
    if (isTrial) trialSchools += 1;
    const plan = school.subscription_plan;
    const monthlyRevenue = !isTrial && plan
      ? moneyNumber(plan.price) / (plan.billing_interval === "YEARLY" ? 12 : 1)
      : 0;
    if (!isTrial && plan) paidSchools += 1;
    mrr += monthlyRevenue;
    const segment = isTrial ? "تجريبي" : plan?.name ?? "بدون خطة";
    const current = planMap.get(segment) ?? { schools: 0, students: 0, mrr: 0 };
    current.schools += 1;
    current.students += school._count.students;
    current.mrr += monthlyRevenue;
    planMap.set(segment, current);
  });
  mrr = Math.round(mrr * 100) / 100;

  // The current month is partial and therefore excluded from trend fitting and
  // period-over-period comparisons. It remains visible in the actual chart.
  const complete = series.slice(0, -1);
  const schoolForecast = forecastTrend(complete.map((item) => item.newSchools), 3, 0);
  const studentForecast = forecastTrend(complete.map((item) => item.newStudents), 3, 0);
  const revenueForecast = forecastTrend(complete.map((item) => item.revenue), 3, 2);
  const forecastMonths = Array.from({ length: 3 }, (_value, index) => {
    const date = addUtcMonths(currentMonth, index + 1);
    return {
      key: monthKey(date),
      label: monthLabel(date),
      newSchools: schoolForecast.values[index],
      newStudents: studentForecast.values[index],
      revenue: revenueForecast.values[index],
    };
  });

  const latestThree = complete.slice(-3);
  const previousThree = complete.slice(-6, -3);
  const successfulPayments = payments.filter((payment) => payment.status === "PAID").length;
  const failedPayments = payments.filter((payment) => payment.status === "FAILED").length;
  const paymentAttempts = successfulPayments + failedPayments;

  return Response.json({
    generatedAt: now,
    months,
    summary: {
      mrr,
      arr: Math.round(mrr * 12 * 100) / 100,
      paidSchools,
      trialSchools,
      averageRevenuePerPaidSchool: paidSchools === 0 ? 0 : Math.round((mrr / paidSchools) * 100) / 100,
      trialToPaidPercent: paidSchools + trialSchools === 0 ? 0 : Math.round((paidSchools / (paidSchools + trialSchools)) * 100),
      paymentSuccessPercent: paymentAttempts === 0 ? null : Math.round((successfulPayments / paymentAttempts) * 100),
    },
    growth: {
      schoolsThreeMonthPercent: percentageChange(
        sum(latestThree.map((item) => item.newSchools)),
        sum(previousThree.map((item) => item.newSchools)),
      ),
      studentsThreeMonthPercent: percentageChange(
        sum(latestThree.map((item) => item.newStudents)),
        sum(previousThree.map((item) => item.newStudents)),
      ),
      revenueThreeMonthPercent: percentageChange(
        sum(latestThree.map((item) => item.revenue)),
        sum(previousThree.map((item) => item.revenue)),
      ),
    },
    series,
    forecast: {
      months: forecastMonths,
      confidence: {
        schools: schoolForecast.confidence,
        students: studentForecast.confidence,
        revenue: revenueForecast.confidence,
      },
      method: "DAMPED_SIX_MONTH_TREND",
      excludesPartialCurrentMonth: true,
    },
    plans: Array.from(planMap.entries())
      .map(([name, value]) => ({ name, ...value, mrr: Math.round(value.mrr * 100) / 100 }))
      .sort((left, right) => right.mrr - left.mrr || right.schools - left.schools),
  }, { headers: { "Cache-Control": "no-store" } });
}
