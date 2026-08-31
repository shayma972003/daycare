import { describe, expect, it } from "vitest";
import { calendarToday } from "@/lib/device-date";
import { automaticSubscriptionEnd } from "@/lib/subscription-period";
import { subscriptionExpired, subscriptionExpiringSoon, subscriptionFilterWhere, subscriptionPaymentStatus } from "@/lib/student-lifecycle";

describe("device-local subscription dates", () => {
  const instant = new Date("2026-08-27T22:30:00Z");
  it("uses the device zone, not the server city, with the same instant", () => {
    expect(calendarToday(instant, "Asia/Tokyo").toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(calendarToday(instant, "America/Los_Angeles").toISOString().slice(0, 10)).toBe("2026-08-27");
    expect(subscriptionExpired("2026-08-27", instant, "Asia/Tokyo")).toBe(true);
    expect(subscriptionExpired("2026-08-27", instant, "America/Los_Angeles")).toBe(false);
  });
  it("uses one seven-calendar-day window for badges and filters, excluding expired", () => {
    const at = new Date("2026-08-27T12:00:00Z");
    for (const [end, expected] of [["2026-08-26", false], ["2026-08-27", true], ["2026-09-02", true], ["2026-09-03", true], ["2026-09-04", false]] as const) {
      expect(subscriptionExpiringSoon(end, at, "UTC")).toBe(expected);
    }
    expect(subscriptionFilterWhere("expiring", calendarToday(at, "UTC"))).toEqual({ enrollmentEndDate: { gte: new Date("2026-08-27"), lt: new Date("2026-09-04") } });
  });
  it("displays pending after expiry without overriding suspension/cancellation", () => {
    expect(subscriptionPaymentStatus("PAID", "2026-08-26", instant, "UTC")).toBe("PENDING");
    expect(subscriptionPaymentStatus("PAID", "2026-08-28", instant, "UTC")).toBe("PAID");
    expect(subscriptionPaymentStatus("CANCELLED", "2026-08-26", instant, "UTC")).toBe("CANCELLED");
    expect(subscriptionPaymentStatus("SUSPENDED", "2026-08-26", instant, "UTC")).toBe("SUSPENDED");
  });
});

describe("one automatic inclusive subscription period", () => {
  it.each([
    ["2026-08-27", "DAILY", "2026-08-27"],
    ["2026-08-27", "MONTHLY", "2026-09-26"],
    ["2026-08-27", "YEARLY", "2027-08-26"],
    ["2026-01-31", "MONTHLY", "2026-02-27"],
    ["2024-01-31", "MONTHLY", "2024-02-28"],
    ["2024-02-29", "YEARLY", "2025-02-27"],
    ["2026-12-31", "MONTHLY", "2027-01-30"],
  ] as const)("%s %s ends on %s", (start, cycle, end) => {
    expect(automaticSubscriptionEnd(new Date(start), cycle)).toEqual(new Date(end));
  });
});
