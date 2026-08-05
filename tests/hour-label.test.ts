import { describe, it, expect } from "vitest";
import { hourLabel, DAY_START_HOUR, DAY_END_HOUR } from "@/lib/calendar";

/**
 * The hour column labels an hour of the day, not an instant, so it is built by
 * hand rather than through Intl — there is no date to format. These pin the two
 * places that arithmetic goes wrong.
 */
describe("hourLabel", () => {
  it("covers the whole day", () => {
    expect(DAY_START_HOUR).toBe(0);
    expect(DAY_END_HOUR).toBe(23);
  });

  it("writes midnight and noon as 12, not 0", () => {
    expect(hourLabel(0, "en")).toBe("12:00 am");
    expect(hourLabel(12, "en")).toBe("12:00 pm");
    expect(hourLabel(0, "ar")).toBe("12:00 ص");
    expect(hourLabel(12, "ar")).toBe("12:00 م");
  });

  it("turns afternoon hours back to 1-11", () => {
    expect(hourLabel(13, "en")).toBe("1:00 pm");
    expect(hourLabel(23, "en")).toBe("11:00 pm");
    expect(hourLabel(23, "ar")).toBe("11:00 م");
  });

  it("keeps morning hours as themselves", () => {
    expect(hourLabel(7, "en")).toBe("7:00 am");
    expect(hourLabel(11, "ar")).toBe("11:00 ص");
  });

  it("never repeats a label across the day", () => {
    const seen = new Set<string>();
    for (let hour = DAY_START_HOUR; hour <= DAY_END_HOUR; hour++) {
      const label = hourLabel(hour, "ar");
      expect(seen.has(label), `${label} appears twice`).toBe(false);
      seen.add(label);
    }
    expect(seen.size).toBe(24);
  });
});
