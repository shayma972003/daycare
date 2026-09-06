import { describe, expect, it } from "vitest";
import {
  calendarSpanOnDay,
  calendarStartHour,
  rangeFor,
} from "@/lib/calendar";
import { parseActivityTiming } from "@/lib/activity-timing";
import { zonedTimeOnDate } from "@/lib/device-date";

describe("device-zone calendar spans", () => {
  it("uses a 23-hour local day across the New York DST boundary", () => {
    const anchor = new Date("2026-03-08T16:00:00.000Z");
    const range = rangeFor("day", anchor, "America/New_York");
    expect(range.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("keeps the device calendar year in Tokyo near UTC midnight", () => {
    const range = rangeFor("day", new Date("2026-12-31T16:30:00.000Z"), "Asia/Tokyo");
    expect(range.days[0].toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(range.to.toISOString()).toBe("2027-01-01T15:00:00.000Z");
  });

  it("shows a multi-day all-day item in every covered day with an exclusive end", () => {
    const item = {
      timing: "allDay" as const,
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: "2026-09-04T00:00:00.000Z",
    };
    expect(calendarSpanOnDay(item, new Date("2026-09-01T07:00:00Z"), "UTC")).toBe(true);
    expect(calendarSpanOnDay(item, new Date("2026-09-03T07:00:00Z"), "UTC")).toBe(true);
    expect(calendarSpanOnDay(item, new Date("2026-09-04T07:00:00Z"), "UTC")).toBe(false);
  });

  it("renders a cross-midnight timed item once per intersecting day and not after a midnight end", () => {
    const item = {
      timing: "timed" as const,
      startAt: "2026-09-01T21:30:00.000Z",
      endAt: "2026-09-02T00:00:00.000Z",
    };
    const first = new Date("2026-09-01T12:00:00Z");
    const second = new Date("2026-09-02T12:00:00Z");
    expect(calendarSpanOnDay(item, first, "UTC")).toBe(true);
    expect(calendarStartHour(item, first, "UTC")).toEqual({ hour: 21, continuation: false });
    expect(calendarSpanOnDay(item, second, "UTC")).toBe(false);

    const continuing = { ...item, endAt: "2026-09-02T02:00:00.000Z" };
    expect(calendarStartHour(continuing, second, "UTC")).toEqual({ hour: 0, continuation: true });
  });
});

describe("activity timing validation", () => {
  it("resolves timed activity wall clocks in the supplied device zone", () => {
    const start = zonedTimeOnDate("2026-11-01", "01:30", "America/New_York")!;
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    expect(parseActivityTiming({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      allDay: false,
      timeZone: "America/New_York",
    })).toMatchObject({ allDay: false, startDate: start, endDate: end });
  });

  it("rejects bad zones and non-positive timed ranges but keeps legacy date rows", () => {
    expect(parseActivityTiming({
      startDate: "2026-09-01T09:00:00Z",
      endDate: "2026-09-01T08:00:00Z",
      allDay: false,
      timeZone: "invalid/zone",
    })).toBeNull();
    expect(parseActivityTiming({ startDate: "2026-09-01", endDate: "2026-09-02" }))
      .toMatchObject({ startDate: new Date("2026-09-01T00:00:00.000Z") });
  });
});
