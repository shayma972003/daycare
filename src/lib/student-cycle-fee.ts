import type { BillingCycle } from "@/generated/prisma/enums";
import { money, type MoneyInput } from "@/lib/money";

/** Explicit student prices (including zero) win; never substitute a monthly
 * price for a daily/yearly subscription or invent an annual price. */
export function resolveStudentCycleFee(cycle: BillingCycle, override: MoneyInput, settings: {
  dailyStudentFee?: MoneyInput;
  weeklyStudentFee?: MoneyInput;
  monthlyStudentFee?: MoneyInput;
  yearlyStudentFee?: MoneyInput;
} | null) {
  const value = override ?? (cycle === "DAILY" ? settings?.dailyStudentFee
    : cycle === "WEEKLY" ? settings?.weeklyStudentFee
    : cycle === "MONTHLY" ? settings?.monthlyStudentFee
    : cycle === "YEARLY" ? settings?.yearlyStudentFee
    : null);
  return value == null ? null : money(value);
}

export const studentFeeSettingsSelect = {
  dailyStudentFee: true,
  weeklyStudentFee: true,
  monthlyStudentFee: true,
  yearlyStudentFee: true,
} as const;

export class StudentCycleFeeError extends Error {
  readonly code = "CYCLE_FEE_REQUIRED";
  constructor() { super("Student subscription fee is not configured"); }
}

export function requireStudentCycleFee(cycle: BillingCycle, settings: Parameters<typeof resolveStudentCycleFee>[2]) {
  const fee = resolveStudentCycleFee(cycle, null, settings);
  if (fee === null || !fee.isFinite() || fee.isNegative()) throw new StudentCycleFeeError();
  return fee;
}
