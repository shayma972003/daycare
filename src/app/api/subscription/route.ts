import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { moyasarEnabled } from "@/lib/env";
import { moneyNumber } from "@/lib/money";
import { withNoStore } from "@/lib/auth-response";

export async function GET() {
  try {
    const session = await requireSession();
    const [school, plans, payments] = await Promise.all([
      prisma.school.findUnique({
        where: { id: session.user.schoolId },
        select: { renewal_date: true, subscription_plan: { select: { id: true, billing_interval: true } } },
      }),
      prisma.subscriptionPlan.findMany({
        where: { is_active: true, billing_interval: { in: ["MONTHLY", "YEARLY"] } },
        select: { id: true, billing_interval: true, price: true },
        orderBy: { price: "asc" },
      }),
      prisma.schoolSubscriptionPayment.findMany({
        where: { school_id: session.user.schoolId },
        select: { id: true, billing_interval: true, amount: true, status: true, created_at: true, paid_at: true },
        orderBy: { created_at: "desc" },
        take: 10,
      }),
    ]);
    return withNoStore(Response.json({
      access: session.subscription,
      configured: moyasarEnabled,
      currentPlan: school?.subscription_plan ?? null,
      renewalDate: school?.renewal_date ?? null,
      plans: plans.map((plan) => ({ ...plan, price: moneyNumber(plan.price) })),
      payments: payments.map((payment) => ({ ...payment, amount: moneyNumber(payment.amount) })),
    }));
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "تعذر تحميل الاشتراك" }, { status: 500 });
  }
}
