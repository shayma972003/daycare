"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { useT } from "@/lib/i18n-provider";

type BillingInterval = "MONTHLY" | "YEARLY";

type CheckoutConfiguration = {
  amountHalalas: number;
  currency: "SAR";
  description: string;
  publishableKey: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

type MoyasarBrowser = {
  init(options: {
    element: HTMLElement;
    amount: number;
    currency: string;
    description: string;
    publishable_api_key: string;
    callback_url: string;
    metadata: Record<string, string>;
    methods: string[];
    supported_networks: string[];
    fixed_width: boolean;
    language: "ar" | "en";
    on_failure: (message: string) => void;
  }): void;
};

declare global {
  interface Window {
    Moyasar?: MoyasarBrowser;
  }
}

const FORM_VERSION = "1.15.0";

export function MoyasarPaymentForm({
  billingInterval,
  onClose,
}: {
  billingInterval: BillingInterval;
  onClose?: () => void;
}) {
  const t = useT();
  const formRef = useRef<HTMLDivElement>(null);
  const [configuration, setConfiguration] = useState<CheckoutConfiguration | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stylesheetId = "moyasar-payment-form-css";
    if (document.getElementById(stylesheetId)) return;
    const link = document.createElement("link");
    link.id = stylesheetId;
    link.rel = "stylesheet";
    link.href = `https://cdn.moyasar.com/mpf/${FORM_VERSION}/moyasar.css`;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .post<CheckoutConfiguration>(
        "/api/subscription/checkout",
        { billingInterval },
        { signal: controller.signal }
      )
      .then((response) => setConfiguration(response.data))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(describeApiError(cause, t("common.error")));
      });
    return () => controller.abort();
  }, [billingInterval, t]);

  useEffect(() => {
    const element = formRef.current;
    if (!element || !configuration || !libraryReady || !window.Moyasar) return;
    element.replaceChildren();
    window.Moyasar.init({
      element,
      amount: configuration.amountHalalas,
      currency: configuration.currency,
      description: configuration.description,
      publishable_api_key: configuration.publishableKey,
      callback_url: configuration.callbackUrl,
      metadata: configuration.metadata,
      methods: ["creditcard"],
      supported_networks: ["mada", "visa", "mastercard"],
      fixed_width: false,
      language: document.documentElement.lang.startsWith("en") ? "en" : "ar",
      on_failure: (message) => setError(message || t("schoolSubscription.paymentFailed")),
    });
    return () => element.replaceChildren();
  }, [configuration, libraryReady, t]);

  return (
    <section
      aria-label={t("schoolSubscription.paymentForm")}
      className="rounded-3xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <Script
        src={`https://cdn.moyasar.com/mpf/${FORM_VERSION}/moyasar.js`}
        strategy="afterInteractive"
        onReady={() => setLibraryReady(true)}
        onError={() => setError(t("schoolSubscription.paymentFormUnavailable"))}
      />
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-950 sm:text-lg">
            {t("schoolSubscription.completePayment")}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t(
              billingInterval === "MONTHLY"
                ? "schoolSubscription.monthlyPayment"
                : "schoolSubscription.yearlyPayment"
            )}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
          >
            {t("common.close")}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {!configuration && !error && (
        <div className="py-10 text-center text-sm text-gray-500">{t("common.loading")}</div>
      )}
      <div ref={formRef} className="mysr-form mx-auto min-h-20 w-full max-w-xl" />
      <p className="mt-4 text-xs leading-6 text-gray-500">
        {t("schoolSubscription.freshAttemptNote")}
      </p>
    </section>
  );
}
