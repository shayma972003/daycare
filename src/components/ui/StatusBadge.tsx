"use client";

import { t } from "@/lib/utils";

type DeliveryStatus = "SENT" | "FAILED";

const PAYMENT_DOT_COLORS: Record<string, string> = {
  PAID:             "bg-[#2D7A4F]",
  LATE:             "bg-[#C45000]",
  CANCELLED:        "bg-[#C0232C]",
  SUSPENDED:        "bg-gray-400",
  "بانتظار الدفع":  "bg-[#7C3AED]",
};

const PAYMENT_TEXT_COLORS: Record<string, string> = {
  PAID:             "text-[#2D7A4F]",
  LATE:             "text-[#C45000]",
  CANCELLED:        "text-[#C0232C]",
  SUSPENDED:        "text-gray-500",
  "بانتظار الدفع":  "text-[#7C3AED]",
};

const PAYMENT_LABELS: Record<string, string> = {
  PAID:             "مدفوع",
  LATE:             "متأخر",
  CANCELLED:        "ملغي",
  SUSPENDED:        "موقف",
  "بانتظار الدفع":  "بانتظار الدفع",
};

const deliveryDotColors: Record<DeliveryStatus, string> = {
  SENT: "bg-[#2D7A4F]",
  FAILED: "bg-[#C0232C]",
};

const deliveryTextColors: Record<DeliveryStatus, string> = {
  SENT: "text-[#2D7A4F]",
  FAILED: "text-[#C0232C]",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const dot = PAYMENT_DOT_COLORS[status] ?? "bg-gray-300";
  const text = PAYMENT_TEXT_COLORS[status] ?? "text-gray-500";
  const label = PAYMENT_LABELS[status] ?? (t(`paymentStatus.${status}`) || status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  );
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${deliveryTextColors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${deliveryDotColors[status]}`} />
      {t(`deliveryStatus.${status}`)}
    </span>
  );
}

export function PeriodBadge({ period }: { period: "MORNING" | "EVENING" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-teal" />
      {t(`periods.${period}`)}
    </span>
  );
}
