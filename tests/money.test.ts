import { describe, expect, it } from "vitest";
import {
  money,
  moneyAdd,
  moneyMaxZero,
  moneyMultiply,
  moneyString,
  moneySubtract,
} from "@/lib/money";
import { calculateRecurringMoney } from "@/lib/finance-calculator";

describe("decimal money helpers", () => {
  it("adds decimal fractions without IEEE-754 drift", () => {
    expect(moneyString(moneyAdd("0.10", "0.20"))).toBe("0.30");
  });

  it("rounds to two decimal places at the monetary boundary", () => {
    expect(moneyString("12.345")).toBe("12.35");
    expect(moneyString(moneyMultiply("10.01", 3))).toBe("30.03");
  });

  it("subtracts and clamps salary amounts safely", () => {
    expect(moneyString(moneySubtract("1000.00", "125.25"))).toBe("874.75");
    expect(moneyString(moneyMaxZero(moneySubtract("10.00", "12.00")))).toBe("0.00");
  });

  it("calculates recurring totals as Decimal", () => {
    const total = calculateRecurringMoney(
      money("999.99"),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-03-31T00:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-03-31T00:00:00Z")
    );
    expect(moneyString(total)).toBe("2999.97");
  });
});
