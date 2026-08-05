import { describe, it, expect } from "vitest";
import { hoursOccupied, coversDay } from "@/lib/calendar";

/**
 * Which rows an entry fills, and which days it appears on.
 *
 * Both were "the one it starts on" — a lesson from 17:00 to 19:00 was a single
 * cell at 17:00, and a programme running the 5th to the 19th was a single cell
 * on the 5th. The row and the day are what "does this clash" and "is this on
 * this week" are read from, so one of each cannot answer either.
 */
describe("hoursOccupied", () => {
  it("fills every hour between start and end", () => {
    expect(hoursOccupied(17, 0, 19, 0)).toEqual([17, 18]);
  });

  it("frees the closing hour, so the next booking can have it", () => {
    // 17:00–19:00 and 19:00–20:00 are back to back, not overlapping.
    expect(hoursOccupied(17, 0, 19, 0)).not.toContain(19);
    expect(hoursOccupied(19, 0, 20, 0)).toEqual([19]);
  });

  it("keeps a part-hour ending in its own row", () => {
    // 17:00–19:30 still runs during the 19th hour.
    expect(hoursOccupied(17, 0, 19, 30)).toEqual([17, 18, 19]);
  });

  it("shows a zero-length entry in one row rather than none", () => {
    expect(hoursOccupied(9, 0, 9, 0)).toEqual([9]);
  });

  it("runs to the end of the day when it finishes on a later one", () => {
    expect(hoursOccupied(22, 0, null, null)).toEqual([22, 23]);
  });
});

describe("coversDay", () => {
  const day = (iso: string) => new Date(iso);

  it("covers the day it starts on", () => {
    expect(coversDay(day("2026-08-05T06:00:00Z"), day("2026-08-05T09:00:00Z"), day("2026-08-05T00:00:00Z"))).toBe(true);
  });

  it("covers the days in between", () => {
    expect(coversDay(day("2026-08-05T06:00:00Z"), day("2026-08-19T09:00:00Z"), day("2026-08-12T00:00:00Z"))).toBe(true);
  });

  it("covers the day it ends on", () => {
    expect(coversDay(day("2026-08-05T06:00:00Z"), day("2026-08-19T09:00:00Z"), day("2026-08-19T00:00:00Z"))).toBe(true);
  });

  it("stops after the end", () => {
    expect(coversDay(day("2026-08-05T06:00:00Z"), day("2026-08-19T09:00:00Z"), day("2026-08-20T00:00:00Z"))).toBe(false);
  });

  it("treats a missing end as a single day", () => {
    expect(coversDay(day("2026-08-05T06:00:00Z"), null, day("2026-08-06T00:00:00Z"))).toBe(false);
    expect(coversDay(day("2026-08-05T06:00:00Z"), null, day("2026-08-05T00:00:00Z"))).toBe(true);
  });
});
