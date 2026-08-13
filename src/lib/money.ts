import { Prisma } from "@/generated/prisma/client";

export type MoneyInput = Prisma.Decimal | number | string | null | undefined;

export function money(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0).toDecimalPlaces(2);
}

export function moneyAdd(...values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((sum, value) => sum.plus(value ?? 0), money(0)).toDecimalPlaces(2);
}

export function moneyMultiply(value: MoneyInput, multiplier: number | string): Prisma.Decimal {
  return money(value).mul(multiplier).toDecimalPlaces(2);
}

export function moneySubtract(left: MoneyInput, right: MoneyInput): Prisma.Decimal {
  return money(left).minus(right ?? 0).toDecimalPlaces(2);
}

export function moneyMaxZero(value: MoneyInput): Prisma.Decimal {
  return Prisma.Decimal.max(money(0), money(value)).toDecimalPlaces(2);
}

/** JSON contract for monetary values. Strings preserve two decimal places. */
export function moneyString(value: MoneyInput): string {
  return money(value).toFixed(2);
}

/** Compatibility boundary for legacy charts/form controls only. */
export function moneyNumber(value: MoneyInput): number {
  return Number(moneyString(value));
}
