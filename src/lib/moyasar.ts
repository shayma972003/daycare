import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
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

type MoyasarPayment = MoyasarInvoice;

type MoyasarPaymentIntent = {
  version: 1;
  schoolId: string;
  planId: string;
  billingInterval: "MONTHLY" | "YEARLY";
  amountHalalas: number;
  createdById: string;
  expiresAt: string;
};

function intentSignature(intent: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(intent).digest("base64url");
}

/**
 * Authorises an embedded Moyasar Form without creating a local pending row.
 * The browser may read this payload, but any change invalidates the signature.
 */
export function createMoyasarPaymentIntent(input: Omit<MoyasarPaymentIntent, "version" | "expiresAt">) {
  const payload: MoyasarPaymentIntent = {
    version: 1,
    ...input,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
  const intent = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { intent, signature: intentSignature(intent) };
}

function readMoyasarPaymentIntent(metadata: Record<string, string> | null | undefined): MoyasarPaymentIntent {
  const intent = metadata?.subscription_intent;
  const signature = metadata?.subscription_signature;
  if (!intent || !signature) throw new Error("PAYMENT_INTENT_MISSING");

  const expected = Buffer.from(intentSignature(intent));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("PAYMENT_INTENT_INVALID");
  }

  const value = JSON.parse(Buffer.from(intent, "base64url").toString("utf8")) as Partial<MoyasarPaymentIntent>;
  if (
    value.version !== 1 ||
    typeof value.schoolId !== "string" ||
    typeof value.planId !== "string" ||
    (value.billingInterval !== "MONTHLY" && value.billingInterval !== "YEARLY") ||
    !Number.isSafeInteger(value.amountHalalas) ||
    Number(value.amountHalalas) < 100 ||
    typeof value.createdById !== "string" ||
    typeof value.expiresAt !== "string" ||
    new Date(value.expiresAt).getTime() < Date.now()
  ) {
    throw new Error("PAYMENT_INTENT_INVALID");
  }
  return value as MoyasarPaymentIntent;
}

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

export function fetchMoyasarPayment(id: string): Promise<MoyasarPayment> {
  return moyasarRequest<MoyasarPayment>(`/payments/${encodeURIComponent(id)}`);
}

/**
 * Applies a completed embedded-form payment. No local row exists before this
 * point: abandoning the form leaves nothing to resume. The school row lock and
 * provider id uniqueness make callback retries idempotent.
 */
export async function verifyAndApplyMoyasarPayment(providerPaymentId: string) {
  const payment = await fetchMoyasarPayment(providerPaymentId);
  const intent = readMoyasarPaymentIntent(payment.metadata);

  if (
    payment.amount !== intent.amountHalalas ||
    payment.currency !== "SAR" ||
    payment.metadata?.school_id !== intent.schoolId ||
    payment.metadata?.plan_id !== intent.planId
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }

  if (payment.status !== "paid") {
    return { applied: false, status: payment.status };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "School"
      WHERE "id" = ${intent.schoolId}
      FOR UPDATE
    `);

    const existing = await tx.schoolSubscriptionPayment.findUnique({
      where: { provider_invoice_id: providerPaymentId },
    });
    if (existing) {
      if (existing.school_id !== intent.schoolId || existing.status !== "PAID") {
        throw new Error("PAYMENT_ID_COLLISION");
      }
      return { applied: false, status: "paid", renewalDate: existing.period_end };
    }

    const [school, plan] = await Promise.all([
      tx.school.findUnique({ where: { id: intent.schoolId }, select: { renewal_date: true } }),
      tx.subscriptionPlan.findFirst({
        where: {
          id: intent.planId,
          is_active: true,
          billing_interval: intent.billingInterval,
        },
        select: { id: true },
      }),
    ]);
    if (!school) throw new Error("SCHOOL_NOT_FOUND");
    if (!plan) throw new Error("SUBSCRIPTION_OPTION_NOT_FOUND");

    const now = new Date();
    const periodStart = school.renewal_date && school.renewal_date > now ? school.renewal_date : now;
    const periodEnd = addSchoolBillingPeriod(periodStart, intent.billingInterval);

    const saved = await tx.schoolSubscriptionPayment.create({
      data: {
        school_id: intent.schoolId,
        plan_id: intent.planId,
        billing_interval: intent.billingInterval,
        amount: intent.amountHalalas / 100,
        currency: "SAR",
        status: "PAID",
        provider: "moyasar-payment-form",
        provider_invoice_id: providerPaymentId,
        created_by_id: intent.createdById,
        paid_at: now,
        period_start: periodStart,
        period_end: periodEnd,
      },
    });
    await tx.school.update({
      where: { id: intent.schoolId },
      data: {
        plan_id: intent.planId,
        subscription_status: "active",
        renewal_date: periodEnd,
        suspended_at: null,
        suspension_reason: null,
      },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: intent.schoolId,
        action: "school_subscription_paid",
        performed_by: "moyasar",
        metadata: {
          paymentId: saved.id,
          providerPaymentId,
          interval: intent.billingInterval,
          amount: intent.amountHalalas / 100,
        },
      },
    });
    return { applied: true, status: "paid", renewalDate: periodEnd };
  });
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

    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "School"
      WHERE "id" = ${current.school_id}
      FOR UPDATE
    `);
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
