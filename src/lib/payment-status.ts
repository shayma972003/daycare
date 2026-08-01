import { PaymentStatus } from "@/generated/prisma/enums";

/**
 * The column is a real enum now, so the allow-list this file used to carry is
 * gone — Prisma generates it. Kept as a thin re-export so existing imports keep
 * working and there is still one place to reach for the list of values.
 */
export { PaymentStatus };

export const PAYMENT_STATUSES = Object.values(PaymentStatus);

export type PaymentStatusValue = PaymentStatus;

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as string[]).includes(value);
}
