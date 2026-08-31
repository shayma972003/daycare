import { describe, expect, it } from "vitest";
import { isOperationallyActive, subscriptionExpired } from "@/lib/student-lifecycle";

describe("student operational lifecycle", () => {
  it("keeps the end date valid through the Riyadh calendar day", () => {
    const end = "2026-08-27T00:00:00.000Z";
    expect(subscriptionExpired(end, new Date("2026-08-27T20:59:59.999Z"), "Asia/Riyadh")).toBe(false);
    expect(subscriptionExpired(end, new Date("2026-08-27T21:00:00.000Z"), "Asia/Riyadh")).toBe(true);
  });

  it("handles Riyadh month and year boundaries", () => {
    expect(subscriptionExpired("2026-01-31", new Date("2026-01-31T20:59:59.999Z"), "Asia/Riyadh")).toBe(false);
    expect(subscriptionExpired("2026-01-31", new Date("2026-01-31T21:00:00.000Z"), "Asia/Riyadh")).toBe(true);
    expect(subscriptionExpired("2026-12-31", new Date("2026-12-31T20:59:59.999Z"), "Asia/Riyadh")).toBe(false);
    expect(subscriptionExpired("2026-12-31", new Date("2026-12-31T21:00:00.000Z"), "Asia/Riyadh")).toBe(true);
  });

  it("does not infer expiry from a missing end date and respects manual status", () => {
    expect(isOperationallyActive({ isActive: true, enrollmentEndDate: null })).toBe(true);
    expect(isOperationallyActive({ isActive: false, enrollmentEndDate: null })).toBe(false);
  });
});
