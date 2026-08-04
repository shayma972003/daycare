"use client";

import { useT } from "@/lib/i18n-provider";
import { parsePaymentStatus } from "@/lib/enum-labels";

type DeliveryStatus = "SENT" | "FAILED";

/**
 * Keyed on the enum only.
 *
 * `PENDING` had no entry at all — the maps were written when the column stored
 * the Arabic literal — so the most common state in the product rendered as a
 * grey dot with an untranslated key beside it. Legacy Arabic values still
 * arriving from older rows are normalised through `parsePaymentStatus` rather
 * than given duplicate entries here.
 */
const PAYMENT_DOT_COLORS: Record<string, string> = {
  PAID:      "bg-[#2D7A4F]",
  LATE:      "bg-[#C45000]",
  CANCELLED: "bg-[#C0232C]",
  SUSPENDED: "bg-gray-400",
  PENDING:   "bg-[#7C3AED]",
};

const PAYMENT_TEXT_COLORS: Record<string, string> = {
  PAID:      "text-[#2D7A4F]",
  LATE:      "text-[#C45000]",
  CANCELLED: "text-[#C0232C]",
  SUSPENDED: "text-gray-500",
  PENDING:   "text-[#7C3AED]",
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
  const t = useT();
  const normalized = parsePaymentStatus(status);
  const dot = normalized ? PAYMENT_DOT_COLORS[normalized] : "bg-gray-300";
  const text = normalized ? PAYMENT_TEXT_COLORS[normalized] : "text-gray-500";
  // Through the dictionary, not the Arabic constant: this badge appears on
  // every roster row, so leaving it untranslated undoes the language switch
  // across the busiest screen in the product.
  const label = normalized ? t(`paymentStatus.${normalized}`) : status;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  );
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${deliveryTextColors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${deliveryDotColors[status]}`} />
      {t(`deliveryStatus.${status}`)}
    </span>
  );
}

export function PeriodBadge({ period }: { period: "MORNING" | "EVENING" }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-teal" />
      {t(`periods.${period}`)}
    </span>
  );
}
