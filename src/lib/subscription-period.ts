import type { BillingCycle } from "@/generated/prisma/enums";
import { DAY_MS, storedDate } from "@/lib/device-date";

export function automaticSubscriptionEnd(today: Date, cycle: BillingCycle, interval?: number | null): Date {
  const start = storedDate(today);
  let next: Date;
  if (cycle === "MONTHLY" || cycle === "YEARLY") {
    const months = cycle === "MONTHLY" ? 1 : 12;
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(start.getUTCDate(), lastDay)));
  } else {
    const days = cycle === "DAILY" ? 1 : cycle === "WEEKLY" ? 7 : interval;
    if (!days || !Number.isInteger(days) || days < 1) throw new Error("BILLING_INTERVAL_REQUIRED");
    next = new Date(start.getTime() + days * DAY_MS);
  }
  // Stored end is inclusive: one daily renewal must not create two daily dues.
  return new Date(next.getTime() - DAY_MS);
}
