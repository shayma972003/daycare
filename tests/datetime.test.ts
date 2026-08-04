import { describe, it, expect } from "vitest";
import { astDayStart, astDayEnd, astDateOnly, astParts, astTimeOnDay } from "@/lib/datetime";

/**
 * The AST business day (task 0.64).
 *
 * These exist because the host clock is UTC on Vercel while the business day is
 * Riyadh: between 21:00 and midnight local, every naive date names yesterday.
 * That produced attendance rows on the wrong day and is the single most
 * repeated defect in this codebase's history.
 */
describe("astDateInputValue", () => {
  it("gives today's Riyadh date, not yesterday's", async () => {
    const { astDateInputValue } = await import("@/lib/datetime");

    // Noon in Riyadh — nowhere near a boundary, and the case that was wrong.
    expect(astDateInputValue(new Date("2026-08-04T09:00:00.000Z"))).toBe("2026-08-04");
  });

  it("rolls over at Riyadh midnight, not UTC midnight", async () => {
    const { astDateInputValue } = await import("@/lib/datetime");

    // 20:59 UTC is still 23:59 on the 4th in Riyadh.
    expect(astDateInputValue(new Date("2026-08-04T20:59:00.000Z"))).toBe("2026-08-04");
    // 21:00 UTC is 00:00 on the 5th.
    expect(astDateInputValue(new Date("2026-08-04T21:00:00.000Z"))).toBe("2026-08-05");
  });

  it("is not the same as slicing astDayStart, which is the bug this replaced", async () => {
    const { astDateInputValue, astDayStart } = await import("@/lib/datetime");

    const noon = new Date("2026-08-04T09:00:00.000Z");
    // `astDayStart` is an *instant* — 21:00 UTC the previous date — so slicing
    // its ISO string yields the day before. Two screens defaulted a departure
    // date that way, and the departure date starts the five-year retention
    // clock.
    expect(astDayStart(noon).toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(astDateInputValue(noon)).toBe("2026-08-04");
  });
});

describe("astDayStart", () => {
  it("anchors to Riyadh midnight, not UTC midnight", () => {
    // 2026-08-03 22:30 UTC is 2026-08-04 01:30 in Riyadh — the case that broke.
    const start = astDayStart(new Date("2026-08-03T22:30:00Z"));
    expect(start.toISOString()).toBe("2026-08-03T21:00:00.000Z");
  });

  it("is stable across the whole business day", () => {
    const morning = astDayStart(new Date("2026-08-04T05:00:00Z"));
    const evening = astDayStart(new Date("2026-08-04T20:59:00Z"));
    expect(morning.toISOString()).toBe(evening.toISOString());
  });

  it("rolls to the next day exactly at Riyadh midnight", () => {
    const before = astDayStart(new Date("2026-08-04T20:59:59Z"));
    const after = astDayStart(new Date("2026-08-04T21:00:00Z"));
    expect(after.getTime() - before.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("astDayEnd", () => {
  it("is exactly 24 hours after the start", () => {
    const at = new Date("2026-08-04T10:00:00Z");
    expect(astDayEnd(at).getTime() - astDayStart(at).getTime()).toBe(86_400_000);
  });
});

describe("astParts", () => {
  it("reports the Riyadh calendar date, not the UTC one", () => {
    const parts = astParts(new Date("2026-12-31T22:00:00Z"));
    // 01:00 on 1 January in Riyadh — a new year, and a different one in UTC.
    expect(parts.year).toBe(2027);
    expect(parts.month).toBe(0);
    expect(parts.day).toBe(1);
  });
});

describe("astDateOnly", () => {
  it("returns UTC midnight of the Riyadh day, for @db.Date equality", () => {
    expect(astDateOnly(new Date("2026-08-03T22:30:00Z")).toISOString()).toBe(
      "2026-08-04T00:00:00.000Z"
    );
  });
});

describe("astTimeOnDay", () => {
  it("resolves a school setting to an instant on that business day", () => {
    const at = astTimeOnDay("07:30", new Date("2026-08-04T10:00:00Z"));
    // 07:30 Riyadh is 04:30 UTC.
    expect(at?.toISOString()).toBe("2026-08-04T04:30:00.000Z");
  });

  it("handles times before 03:00 without rolling back a day", () => {
    // The original `setUTCHours(h - 3)` produced a negative hour here and
    // silently moved the instant to the previous day — task 0.66.
    const at = astTimeOnDay("01:00", new Date("2026-08-04T10:00:00Z"));
    expect(at?.toISOString()).toBe("2026-08-03T22:00:00.000Z");
  });

  it("rejects malformed input rather than guessing", () => {
    expect(astTimeOnDay("7:30 pm")).toBeNull();
    expect(astTimeOnDay("25:00")).toBeNull();
    expect(astTimeOnDay("")).toBeNull();
  });
});
