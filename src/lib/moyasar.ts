import "server-only";

import { env, moyasarEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { addSchoolBillingPeriod } from "@/lib/school-subscription";
import { Prisma } from "@/generated/prisma/client";

const API_BASE = "https://api.moyasar.com/v1";

type MoyasarInvoice = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url?: string;
  metadata?: Record<string, string> | null;
};

async function moyasarRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!moyasarEnabled || !env.MOYASAR_SECRET_KEY) throw new Error("MOYASAR_NOT_CONFIGURED");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.MOYASAR_SECRET_KEY}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`MOYASAR_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

export function createMoyasarInvoice(input: {
  amountHalalas: number;
  description: string;
  metadata: Record<string, string>;
}): Promise<MoyasarInvoice> {
  return moyasarRequest<MoyasarInvoice>("/invoices", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountHalalas,
      currency: "SAR",
      description: input.description,
      callback_url: `${env.APP_URL}/api/payments/moyasar/callback`,
      success_url: `${env.APP_URL}/subscription?payment=success`,
      back_url: `${env.APP_URL}/subscription?payment=cancelled`,
      metadata: input.metadata,
    }),
  });
}

export function fetchMoyasarInvoice(id: string): Promise<MoyasarInvoice> {
  return moyasarRequest<MoyasarInvoice>(`/invoices/${encodeURIComponent(id)}`);
}

export async function verifyAndApplyMoyasarInvoice(providerInvoiceId: string) {
  const invoice = await fetchMoyasarInvoice(providerInvoiceId);
  const metadataPaymentId = invoice.metadata?.payment_id;
  const payment = await prisma.schoolSubscriptionPayment.findFirst({
    where: {
      OR: [
        { provider_invoice_id: providerInvoiceId },
        ...(metadataPaymentId ? [{ id: metadataPaymentId }] : []),
      ],
    },
  });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");

  const expectedHalalas = Math.round(Number(payment.amount) * 100);
  if (
    invoice.amount !== expectedHalalas ||
    invoice.currency !== payment.currency ||
    invoice.metadata?.payment_id !== payment.id ||
    invoice.metadata?.school_id !== payment.school_id
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }

  if (invoice.status !== "paid") {
    if (["failed", "canceled", "expired", "voided"].includes(invoice.status)) {
      await prisma.schoolSubscriptionPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: invoice.status === "canceled" ? "CANCELLED" : "FAILED", failure_reason: invoice.status },
      });
    }
    return { applied: false, status: invoice.status };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SchoolSubscriptionPayment"
      WHERE "id" = ${payment.id}
      FOR UPDATE
    `);
    const current = await tx.schoolSubscriptionPayment.findUnique({ where: { id: payment.id } });
    if (!current) throw new Error("PAYMENT_NOT_FOUND");
    if (current.status === "PAID") return { applied: false, status: "paid" };

    const school = await tx.school.findUnique({ where: { id: current.school_id }, select: { renewal_date: true } });
    if (!school) throw new Error("SCHOOL_NOT_FOUND");
    const now = new Date();
    const periodStart = school.renewal_date && school.renewal_date > now ? school.renewal_date : now;
    const periodEnd = addSchoolBillingPeriod(periodStart, current.billing_interval);

    await tx.schoolSubscriptionPayment.update({
      where: { id: current.id },
      data: { status: "PAID", provider_invoice_id: providerInvoiceId, paid_at: now, period_start: periodStart, period_end: periodEnd },
    });
    await tx.school.update({
      where: { id: current.school_id },
      data: {
        plan_id: current.plan_id,
        subscription_status: "active",
        renewal_date: periodEnd,
        suspended_at: null,
        suspension_reason: null,
      },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: current.school_id,
        action: "school_subscription_paid",
        performed_by: "moyasar",
        metadata: { paymentId: current.id, providerInvoiceId, interval: current.billing_interval, amount: Number(current.amount) },
      },
    });
    return { applied: true, status: "paid", renewalDate: periodEnd };
  });
}
