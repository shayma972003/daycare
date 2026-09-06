import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { moyasarEnabled } from "@/lib/env";
import { createMoyasarInvoice } from "@/lib/moyasar";
import { moneyNumber } from "@/lib/money";
import { schoolPlanLabel } from "@/lib/school-subscription";

const bodySchema = z.object({ billingInterval: z.enum(["MONTHLY", "YEARLY"]) }).strict();

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!moyasarEnabled) return Response.json({ error: "بوابة الدفع غير مهيأة بعد" }, { status: 503 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "نوع الاشتراك غير صالح" }, { status: 422 });

    const plan = await prisma.subscriptionPlan.findFirst({
      where: { billing_interval: parsed.data.billingInterval, is_active: true },
    });
    if (!plan) return Response.json({ error: "الخطة غير متاحة" }, { status: 409 });

    const recent = await prisma.schoolSubscriptionPayment.findFirst({
      where: {
        school_id: session.user.schoolId,
        billing_interval: parsed.data.billingInterval,
        status: "PENDING",
        checkout_url: { not: null },
        created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
      orderBy: { created_at: "desc" },
    });
    if (recent?.checkout_url) return Response.json({ checkoutUrl: recent.checkout_url, reused: true });

    const payment = await prisma.schoolSubscriptionPayment.create({
      data: {
        school_id: session.user.schoolId,
        plan_id: plan.id,
        billing_interval: parsed.data.billingInterval,
        amount: plan.price,
        created_by_id: session.user.id,
      },
    });

    try {
      const invoice = await createMoyasarInvoice({
        amountHalalas: Math.round(moneyNumber(plan.price) * 100),
        description: `اشتراك ${schoolPlanLabel(parsed.data.billingInterval)} لنظام إدارة الحضانة`,
        metadata: { payment_id: payment.id, school_id: session.user.schoolId, plan_id: plan.id },
      });
      if (!invoice.id || !invoice.url) throw new Error("INVALID_MOYASAR_RESPONSE");
      await prisma.schoolSubscriptionPayment.update({
        where: { id: payment.id },
        data: { provider_invoice_id: invoice.id, checkout_url: invoice.url },
      });
      return Response.json({ checkoutUrl: invoice.url });
    } catch {
      await prisma.schoolSubscriptionPayment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failure_reason: "invoice_creation_failed" } });
      return Response.json({ error: "تعذر بدء الدفع عبر ميسر، حاولي لاحقًا" }, { status: 502 });
    }
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "تعذر بدء الدفع" }, { status: 500 });
  }
}
