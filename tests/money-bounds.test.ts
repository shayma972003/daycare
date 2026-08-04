import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Bounds on money, pinned after a deep audit found them missing.
 *
 * These schemas live inside route files and cannot be imported without pulling a
 * Next.js request context in with them, so the shapes are restated here. That is
 * a real weakness — a route could drift from its test — and it is still worth
 * having, because what these encode is *why* the bound exists, which is the part
 * that gets removed by someone who thinks it is noise.
 */

const salary = z.number().min(0).max(1_000_000);
const deductionRate = z.number().min(0).max(100);
const lineItem = z.object({
  qty: z.number().min(0).max(10_000),
  price: z.number().min(0).max(10_000_000),
});

describe("salaries", () => {
  it("refuses a negative salary", () => {
    // A staff member at −5000 is subtracted from the month's wage bill, and
    // nothing in the interface explains where the shortfall came from.
    expect(salary.safeParse(-5000).success).toBe(false);
    expect(salary.safeParse(-0.01).success).toBe(false);
  });

  it("refuses a slipped decimal point", () => {
    expect(salary.safeParse(10_000_000).success).toBe(false);
  });

  it("accepts a real salary, and zero for an unpaid role", () => {
    expect(salary.safeParse(5000).success).toBe(true);
    expect(salary.safeParse(0).success).toBe(true);
  });

  it("keeps the late-deduction rate inside 0–100 per cent", () => {
    expect(deductionRate.safeParse(-1).success).toBe(false);
    expect(deductionRate.safeParse(500).success).toBe(false);
    expect(deductionRate.safeParse(25).success).toBe(true);
  });
});

describe("invoice line items", () => {
  it("refuses a negative price", () => {
    // A negative line reduces the total and the VAT with it, producing a
    // smaller, entirely plausible-looking tax document. A credit is a separate
    // document, not a minus sign in a price box.
    expect(lineItem.safeParse({ qty: 1, price: -900 }).success).toBe(false);
  });

  it("refuses a negative quantity", () => {
    expect(lineItem.safeParse({ qty: -5, price: 1000 }).success).toBe(false);
  });

  it("accepts an ordinary line", () => {
    expect(lineItem.safeParse({ qty: 2, price: 1200 }).success).toBe(true);
  });
});
