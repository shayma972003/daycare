import { describe, it, expect } from "vitest";
import { nthDueDate, cycleCount, describeCycle } from "@/lib/billing-cycles";

/**
 * When a fee falls due (task 0.54).
 *
 * The month-rollover bug this guards against — 31 January + 1 month becoming
 * 3 March — already shipped once, in `generatePaymentCycles`, and put payment
 * dates in the wrong month for every child enrolled on a 29th, 30th or 31st.
 */
describe("nthDueDate — monthly", () => {
  it("keeps the same day of month", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    expect(nthDueDate(start, "MONTHLY", 0).toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(nthDueDate(start, "MONTHLY", 1).toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(nthDueDate(start, "MONTHLY", 2).toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("clamps to the last day when the target month is shorter", () => {
    // The defect: naive arithmetic rolls 31 January into 3 March, skipping
    // February's invoice entirely.
    const start = new Date("2026-01-31T00:00:00Z");
    expect(nthDueDate(start, "MONTHLY", 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(nthDueDate(start, "MONTHLY", 2).toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("clamps to 29 February in a leap year", () => {
    const start = new Date("2028-01-31T00:00:00Z");
    expect(nthDueDate(start, "MONTHLY", 1).toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});

describe("nthDueDate — other cycles", () => {
  it("advances daily and weekly by fixed spans", () => {
    const start = new Date("2026-03-01T00:00:00Z");
    expect(nthDueDate(start, "DAILY", 5).toISOString().slice(0, 10)).toBe("2026-03-06");
    expect(nthDueDate(start, "WEEKLY", 2).toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("advances yearly by calendar, not by 365 days", () => {
    // Crossing a leap year: a fixed 365-day step would land on 28 February.
    const start = new Date("2027-03-01T00:00:00Z");
    expect(nthDueDate(start, "YEARLY", 1).toISOString().slice(0, 10)).toBe("2028-03-01");
  });

  it("uses the supplied interval for a custom cycle", () => {
    const start = new Date("2026-03-01T00:00:00Z");
    expect(nthDueDate(start, "CUSTOM", 2, 10).toISOString().slice(0, 10)).toBe("2026-03-21");
  });

  it("falls back to monthly when a custom interval is missing or absurd", () => {
    // A zero interval would otherwise generate an unbounded run of identical
    // due dates.
    const start = new Date("2026-03-01T00:00:00Z");
    expect(nthDueDate(start, "CUSTOM", 1, 0).toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(nthDueDate(start, "CUSTOM", 1, null).toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});

describe("cycleCount", () => {
  it("counts inclusively from the first due date", () => {
    expect(
      cycleCount(new Date("2026-01-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"), "MONTHLY")
    ).toBe(3);
  });

  it("is zero when the range is inverted", () => {
    expect(
      cycleCount(new Date("2026-06-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"), "MONTHLY")
    ).toBe(0);
  });

  it("respects the cap rather than running away", () => {
    expect(
      cycleCount(new Date("2020-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"), "DAILY", null, 50)
    ).toBe(50);
  });
});

describe("describeCycle", () => {
  it("spells out a custom interval", () => {
    expect(describeCycle("CUSTOM", 45)).toBe("كل 45 يوماً");
  });

  it("names the standard cycles", () => {
    expect(describeCycle("MONTHLY")).toBe("شهري");
    expect(describeCycle("YEARLY")).toBe("سنوي");
  });
});
