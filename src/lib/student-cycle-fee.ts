import type { BillingCycle } from "@/generated/prisma/enums";
import { money, type MoneyInput } from "@/lib/money";

/** Explicit student prices (including zero) win; never substitute a monthly
 * price for a daily/yearly subscription or invent an annual price. */
export function resolveStudentCycleFee(cycle: BillingCycle, override: MoneyInput, settings: {
  dailyStudentFee?: MoneyInput; monthlyStudentFee?: MoneyInput;
} | null) {
  const value = override ?? (cycle === "DAILY" ? settings?.dailyStudentFee
    : cycle === "MONTHLY" ? settings?.monthlyStudentFee : null);
  return value == null ? null : money(value);
}
