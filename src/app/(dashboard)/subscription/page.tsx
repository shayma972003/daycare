"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { useT } from "@/lib/i18n-provider";
import { describeApiError } from "@/lib/api-error";
import { MoyasarPaymentForm } from "@/components/subscription/MoyasarPaymentForm";

type Interval = "MONTHLY" | "YEARLY";
type SubscriptionData = {
  configured: boolean;
  renewalDate: string | null;
  plans: { id: string; billing_interval: Interval; price: number }[];
  payments: { id: string; billing_interval: Interval; amount: number; status: string; created_at: string; paid_at: string | null }[];
};

export default function SubscriptionPage() {
  const t = useT();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPayment, setSelectedPayment] = useState<Interval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData((await axios.get<SubscriptionData>("/api/subscription")).data);
    } catch (cause) {
      setError(describeApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      setReturnState(new URLSearchParams(window.location.search).get("payment"));
      return load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={t("schoolSubscription.title")} />
      <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">{t("schoolSubscription.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("schoolSubscription.subtitle")}</p>
          {data?.renewalDate && <p className="mt-2 text-sm text-gray-700">{t("schoolSubscription.currentEnds", { date: new Date(data.renewalDate).toLocaleDateString() })}</p>}
        </div>

        {returnState === "success" && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{t("schoolSubscription.paymentSuccess")}</div>}
        {returnState === "cancelled" && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t("schoolSubscription.paymentCancelled")}</div>}
        {returnState === "failed" && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t("schoolSubscription.paymentFailed")}</div>}
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {!loading && data && !data.configured && <div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{t("schoolSubscription.notConfigured")}</div>}

        <section className="grid gap-4 md:grid-cols-2">
          {(data?.plans ?? []).map((plan) => {
            const monthly = plan.billing_interval === "MONTHLY";
            return (
              <article key={plan.id} className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold text-indigo-700">{t(monthly ? "schoolSubscription.monthly" : "schoolSubscription.yearly")}</div>
                <div className="mt-4 flex items-end gap-2"><span className="text-4xl font-black text-gray-950">{plan.price}</span><span className="pb-1 text-sm text-gray-500">ر.س</span></div>
                <p className="mt-2 text-sm text-gray-500">{t(monthly ? "schoolSubscription.perMonth" : "schoolSubscription.perYear")}</p>
                <button type="button" disabled={!data?.configured} onClick={() => setSelectedPayment(plan.billing_interval)} className="mt-6 w-full rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {selectedPayment === plan.billing_interval ? t("schoolSubscription.paymentFormOpen") : t("schoolSubscription.renew")}
                </button>
              </article>
            );
          })}
          {loading && <div className="col-span-full rounded-2xl bg-white p-8 text-center text-sm text-gray-500">{t("common.loading")}</div>}
        </section>

        {selectedPayment && data?.configured && (
          <MoyasarPaymentForm
            key={selectedPayment}
            billingInterval={selectedPayment}
            onClose={() => setSelectedPayment(null)}
          />
        )}

        <section className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="font-bold text-gray-950">{t("schoolSubscription.history")}</h2>
          <div className="mt-4 divide-y divide-gray-100">
            {(data?.payments ?? []).map((payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{t(payment.billing_interval === "MONTHLY" ? "schoolSubscription.monthly" : "schoolSubscription.yearly")}</span><span>{payment.amount} ر.س</span><span className="text-gray-500">{payment.status}</span><span className="text-gray-500">{new Date(payment.created_at).toLocaleDateString()}</span></div>)}
            {!loading && (data?.payments.length ?? 0) === 0 && <p className="py-5 text-sm text-gray-500">{t("schoolSubscription.noPayments")}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
