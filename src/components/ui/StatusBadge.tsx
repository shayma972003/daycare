"use client";

import { t } from "@/lib/utils";

type DeliveryStatus = "SENT" | "FAILED";

const PAYMENT_COLORS: Record<string, string> = {
  PAID:             "bg-success-bg text-success-text",
  LATE:             "bg-warning-bg text-warning-text",
  CANCELLED:        "bg-danger-bg text-danger-text",
  SUSPENDED:        "bg-neutral-bg text-neutral-text",
  "بانتظار الدفع":  "bg-pending-bg text-pending-text",
};

const PAYMENT_LABELS: Record<string, string> = {
  PAID:             "مدفوع",
  LATE:             "متأخر",
  CANCELLED:        "ملغي",
  SUSPENDED:        "موقف",
  "بانتظار الدفع":  "بانتظار الدفع",
};

const deliveryColors: Record<DeliveryStatus, string> = {
  SENT: "bg-success-bg text-success-text",
  FAILED: "bg-danger-bg text-danger-text",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const cls = PAYMENT_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = PAYMENT_LABELS[status] ?? (t(`paymentStatus.${status}`) || status);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${deliveryColors[status]}`}>
      {t(`deliveryStatus.${status}`)}
    </span>
  );
}

export function PeriodBadge({ period }: { period: "MORNING" | "EVENING" }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-light text-teal-dark">
      {t(`periods.${period}`)}
    </span>
  );
}
