import { describe, it, expect } from "vitest";
import { astInputValue, astInputToDate, astParts } from "@/lib/datetime";

/**
 * The calendar form used the browser's `getTimezoneOffset()` while every
 * rendering path uses the fixed +3 model, so on a device set to anything else
 * an event jumped hours between the form and the grid. These pin the round
 * trip to Riyadh regardless of where the machine running them is.
 */
describe("datetime-local in Riyadh terms", () => {
  it("shows an instant at its Riyadh wall clock", () => {
    // 14:00Z is 17:00 in Riyadh.
    expect(astInputValue(new Date("2026-08-05T14:00:00Z"))).toBe("2026-08-05T17:00");
  });

  it("reads a typed wall clock back to the right instant", () => {
    expect(astInputToDate("2026-08-05T17:00").toISOString()).toBe("2026-08-05T14:00:00.000Z");
  });

  it("round-trips without drifting", () => {
    const typed = "2026-08-05T17:30";
    expect(astInputValue(astInputToDate(typed))).toBe(typed);
  });

  it("agrees with the grid about which hour the event sits in", () => {
    // What the form writes and what hoursOccupied reads must be the same hour.
    const instant = astInputToDate("2026-08-05T17:00");
    expect(astParts(instant).hour).toBe(17);
  });

  it("keeps a late-evening entry on its own day", () => {
    const instant = astInputToDate("2026-08-05T23:30");
    expect(astParts(instant).day).toBe(5);
    expect(astParts(instant).hour).toBe(23);
  });
});
