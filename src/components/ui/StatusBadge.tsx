"use client";

import { t } from "@/lib/utils";

type PaymentStatus = "PAID" | "LATE" | "CANCELLED" | "SUSPENDED";
type DeliveryStatus = "SENT" | "FAILED";

const paymentColors: Record<PaymentStatus, string> = {
  PAID: "badge-paid",
  LATE: "badge-late",
  CANCELLED: "badge-cancelled",
  SUSPENDED: "badge-suspended",
};

const deliveryColors: Record<DeliveryStatus, string> = {
  SENT: "badge-paid",
  FAILED: "badge-cancelled",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${paymentColors[status]}`}
    >
      {t(`paymentStatus.${status}`)}
    </span>
  );
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${deliveryColors[status]}`}
    >
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
