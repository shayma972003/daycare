import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { env, moyasarEnabled } from "@/lib/env";
import { createMoyasarPaymentIntent } from "@/lib/moyasar";
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

    const amountHalalas = Math.round(moneyNumber(plan.price) * 100);
    const authorization = createMoyasarPaymentIntent({
      schoolId: session.user.schoolId,
      planId: plan.id,
      billingInterval: parsed.data.billingInterval,
      amountHalalas,
      createdById: session.user.id,
    });

    // No PENDING row is created here. If the user closes the embedded form,
    // there is deliberately no local checkout to resume; pressing pay again
    // starts a fresh authorised attempt.
    return Response.json({
      amountHalalas,
      currency: "SAR",
      description: `اشتراك ${schoolPlanLabel(parsed.data.billingInterval)} لنظام إدارة الحضانة`,
      publishableKey: env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY,
      callbackUrl: `${env.APP_URL}/api/payments/moyasar/callback`,
      metadata: {
        school_id: session.user.schoolId,
        plan_id: plan.id,
        subscription_intent: authorization.intent,
        subscription_signature: authorization.signature,
      },
    });
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "تعذر بدء الدفع" }, { status: 500 });
  }
}
