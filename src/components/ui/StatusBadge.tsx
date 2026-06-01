"use client";

import { t } from "@/lib/utils";

type DeliveryStatus = "SENT" | "FAILED";

const PAYMENT_COLORS: Record<string, string> = {
  PAID:             "bg-green-100 text-green-700",
  LATE:             "bg-orange-100 text-orange-700",
  CANCELLED:        "bg-red-100 text-red-700",
  SUSPENDED:        "bg-slate-100 text-slate-600",
  "بانتظار الدفع":  "bg-purple-100 text-purple-700",
};

const PAYMENT_LABELS: Record<string, string> = {
  PAID:             "مدفوع",
  LATE:             "متأخر",
  CANCELLED:        "ملغي",
  SUSPENDED:        "موقف",
  "بانتظار الدفع":  "بانتظار الدفع",
};

const deliveryColors: Record<DeliveryStatus, string> = {
  SENT: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
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
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
      {t(`periods.${period}`)}
    </span>
  );
}
