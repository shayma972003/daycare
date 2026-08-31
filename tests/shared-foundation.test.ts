import { describe, expect, it } from "vitest";
import { optionalPhone } from "@/lib/form-schemas";
import {
  calendarToday,
  dateLabel,
  deviceDateInputValue,
  deviceWeekStart,
  localDayBounds,
  requestTimeZone,
  storedDate,
} from "@/lib/device-date";
import { formatDurationHours } from "@/lib/datetime";
import { normalizePhone } from "@/lib/phone-normalizer";

describe("shared phone and date helpers", () => {
  it.each([
    ["0551234567", "+966551234567"], ["551234567", "+966551234567"],
    ["+966 55-123-4567", "+966551234567"], ["00966551234567", "+966551234567"],
    ["٠٥٥١٢٣٤٥٦٧", "+966551234567"], ["۰۵۵۱۲۳۴۵۶۷", "+966551234567"],
  ])("normalizes %s", (input, expected) => {
    expect(optionalPhone.safeParse(input).success).toBe(true);
    expect(normalizePhone(input)).toBe(expected);
  });

  it("uses the device calendar near midnight and the start of the week", () => {
    const midnightBoundary = new Date("2026-08-30T23:30:00.000Z");
    expect(deviceDateInputValue(midnightBoundary, "Asia/Tokyo")).toBe("2026-08-31");
    expect(deviceDateInputValue(midnightBoundary, "America/Los_Angeles")).toBe("2026-08-30");
    const weekBoundary = new Date("2026-08-30T01:00:00.000Z");
    expect(deviceWeekStart(weekBoundary, "Asia/Tokyo").toISOString().slice(0, 10)).toBe("2026-08-30");
    expect(deviceWeekStart(weekBoundary, "America/Los_Angeles").toISOString().slice(0, 10)).toBe("2026-08-23");
  });

  it("validates request zones and handles DST calendar days", () => {
    expect(requestTimeZone(new Request("https://example.invalid"))).toBe("UTC");
    expect(requestTimeZone(new Request("https://example.invalid", { headers: { "X-Time-Zone": "Pacific/Auckland" } }))).toBe("Pacific/Auckland");
    expect(() => requestTimeZone(new Request("https://example.invalid", { headers: { "X-Time-Zone": "not-a-zone" } }))).toThrow("INVALID_TIME_ZONE");
    for (const [at, hours] of [["2026-03-08T12:00:00Z", 23], ["2026-11-01T12:00:00Z", 25]] as const) {
      const { start, end } = localDayBounds(new Date(at), "America/New_York");
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(hours);
      expect(calendarToday(start, "America/New_York")).toEqual(calendarToday(new Date(at), "America/New_York"));
    }
  });

  it("keeps stored dates stable and formats durations beyond 24 hours", () => {
    expect(storedDate("2026-08-27T00:00:00Z")).toEqual(new Date("2026-08-27"));
    expect(dateLabel("2026-08-27", "en")).toBe("27/08/2026");
    expect(dateLabel("2026-08-27", "ar")).toBe("27/08/2026");
    expect(dateLabel("2026-09-26", "ar")).not.toMatch(/[\u200e\u200f\u061c]/);
    expect(formatDurationHours(0)).toBe("00:00");
    expect(formatDurationHours(1.5)).toBe("01:30");
    expect(formatDurationHours(27.25)).toBe("27:15");
    expect(formatDurationHours(1.999)).toBe("02:00");
  });
});
