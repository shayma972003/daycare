import { describe, it, expect } from "vitest";
import { astParts } from "@/lib/datetime";
import {
  computeRetentionUntil,
  monthsBetween,
  toNationalityCode,
  isValidRetentionYears,
  buildStudentDeparture,
  astYear,
  nextSweepAt,
} from "@/lib/data-retention";

/**
 * When a child's personal data expires (task D3.12).
 *
 * This is the calculation that decides an irreversible deletion. Getting it
 * wrong by a day is invisible until the day it destroys something early.
 */
describe("computeRetentionUntil", () => {
  it("adds the retention period from the Riyadh day of departure", () => {
    const left = new Date("2026-08-04T10:00:00Z");
    expect(computeRetentionUntil(left, 5).toISOString()).toBe("2031-08-03T21:00:00.000Z");
  });

  it("gives the same expiry whatever time of day the child left", () => {
    const morning = computeRetentionUntil(new Date("2026-08-04T05:00:00Z"), 5);
    const lateEvening = computeRetentionUntil(new Date("2026-08-04T20:00:00Z"), 5);
    expect(morning.toISOString()).toBe(lateEvening.toISOString());
  });

  it("handles 29 February the way the calendar does", () => {
    // 2028 is a leap year, 2033 is not. Landing on 1 March is correct; throwing
    // or silently dropping a year is not.
    //
    // Asserted through `astParts`, not on the ISO string: these instants are
    // Riyadh midnights, so their UTC representation is 21:00 the *previous*
    // day. Reading the UTC slice would report 28 February and look like a bug
    // in code that is behaving correctly — which is exactly what the first
    // version of this test did.
    const expiry = computeRetentionUntil(new Date("2028-02-29T09:00:00Z"), 5);
    const parts = astParts(expiry);
    expect(parts.year).toBe(2033);
    expect(parts.month).toBe(2); // March, zero-indexed
    expect(parts.day).toBe(1);
  });
});

describe("isValidRetentionYears", () => {
  it("accepts the documented range", () => {
    expect(isValidRetentionYears(3)).toBe(true);
    expect(isValidRetentionYears(5)).toBe(true);
    expect(isValidRetentionYears(15)).toBe(true);
  });

  it("refuses values that would disable the policy or break bookkeeping", () => {
    expect(isValidRetentionYears(2)).toBe(false);
    expect(isValidRetentionYears(16)).toBe(false);
    expect(isValidRetentionYears(0)).toBe(false);
    expect(isValidRetentionYears(5.5)).toBe(false);
  });
});

describe("buildStudentDeparture", () => {
  it("starts the clock and deactivates on departure", () => {
    const result = buildStudentDeparture("GRADUATED", new Date("2026-06-30T08:00:00Z"), 5);
    expect(result.status).toBe("GRADUATED");
    expect(result.isActive).toBe(false);
    expect(result.leftYear).toBe(2026);
    expect(result.retentionUntil).not.toBeNull();
  });

  it("clears the clock entirely when a child returns", () => {
    // The worst failure this feature can have is sweeping a child who is
    // enrolled again, so ACTIVE must leave nothing ticking.
    const result = buildStudentDeparture("ACTIVE", new Date("2026-06-30T08:00:00Z"), 5);
    expect(result.leftAt).toBeNull();
    expect(result.retentionUntil).toBeNull();
    expect(result.leftYear).toBeNull();
    expect(result.isActive).toBe(true);
  });

  it("defaults the departure date to now when none is given", () => {
    const result = buildStudentDeparture("WITHDRAWN", null, 5);
    expect(result.leftAt).toBeInstanceOf(Date);
    expect(result.retentionUntil).toBeInstanceOf(Date);
  });
});

/**
 * Age at enrolment — derived once, at anonymisation, from a field about to be
 * destroyed. If this is wrong the error is permanent.
 */
describe("monthsBetween", () => {
  it("counts whole months", () => {
    expect(monthsBetween(new Date("2025-01-15T00:00:00Z"), new Date("2026-01-15T00:00:00Z"))).toBe(12);
  });

  it("does not round a partial month up", () => {
    expect(monthsBetween(new Date("2025-01-20T00:00:00Z"), new Date("2025-02-19T00:00:00Z"))).toBe(0);
  });

  it("keeps infant cohorts distinguishable", () => {
    // 0–6m and 6–12m are different rooms with different ratios; rounding to
    // years would collapse them into one.
    expect(monthsBetween(new Date("2026-01-10T00:00:00Z"), new Date("2026-05-10T00:00:00Z"))).toBe(4);
  });

  it("never goes negative", () => {
    expect(monthsBetween(new Date("2026-05-10T00:00:00Z"), new Date("2026-01-10T00:00:00Z"))).toBe(0);
  });
});

describe("toNationalityCode", () => {
  it("collapses spelling variants of one nationality onto one code", () => {
    // The whole point: an aggregate grouped on raw text splits this cohort four
    // ways and reports nonsense.
    expect(toNationalityCode("سعودي")).toBe("SA");
    expect(toNationalityCode("سعودية")).toBe("SA");
    expect(toNationalityCode("السعودية")).toBe("SA");
    expect(toNationalityCode("Saudi")).toBe("SA");
  });

  it("passes through an existing two-letter code", () => {
    expect(toNationalityCode("eg")).toBe("EG");
  });

  it("slugs an unknown value rather than discarding it", () => {
    expect(toNationalityCode("جنسية غير معروفة")).toBe("جنسية_غير_معروفة");
  });

  it("treats blank as absent", () => {
    expect(toNationalityCode("")).toBeNull();
    expect(toNationalityCode("   ")).toBeNull();
    expect(toNationalityCode(null)).toBeNull();
  });
});

describe("astYear", () => {
  it("uses the Riyadh year at the boundary", () => {
    expect(astYear(new Date("2026-12-31T22:00:00Z"))).toBe(2027);
  });
});

describe("nextSweepAt", () => {
  it("is always in the future", () => {
    const now = new Date("2026-08-04T10:00:00Z");
    expect(nextSweepAt(now).getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls to tomorrow once today's run has passed", () => {
    const afterRun = new Date("2026-08-04T05:00:00Z");
    expect(nextSweepAt(afterRun).toISOString()).toBe("2026-08-05T03:00:00.000Z");
  });
});
