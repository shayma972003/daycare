/**
 * The single vocabulary for `Student.paymentStatus`.
 *
 * The column is a free-text String and receives English values from
 * payment-status-updater and an Arabic one for "awaiting payment", so every
 * consumer has to handle both alphabets for one logical state. Until the column
 * is migrated to an enum, this is the allow-list every write path validates
 * against — it at least stops arbitrary strings landing in the column.
 */
export const PAYMENT_STATUSES = [
  "PAID",
  "LATE",
  "SUSPENDED",
  "CANCELLED",
  "بانتظار الدفع",
] as const;

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: string): value is PaymentStatusValue {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}
