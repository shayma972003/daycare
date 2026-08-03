import { describe, it, expect } from "vitest";
import {
  expectedDays,
  isExpectedOn,
  attendanceRatio,
  capacityState,
  ageGroupForMonths,
  monthsOld,
  DEFAULT_ATTENDANCE_DAYS,
} from "@/lib/attendance-schedule";

/**
 * Attendance expectations and capacity (tasks 2.10–2.13).
 */
describe("expectedDays", () => {
  it("treats an empty schedule as the normal working week", () => {
    // Every existing row starts empty; reading that as "never expected" would
    // mark the whole school as not-attending until someone edited every child.
    expect(expectedDays([])).toEqual(DEFAULT_ATTENDANCE_DAYS);
  });

  it("uses an explicit schedule when set", () => {
    expect(expectedDays([0, 2, 4])).toEqual([0, 2, 4]);
  });
});

describe("isExpectedOn", () => {
  it("matches the Riyadh weekday", () => {
    // 2026-08-04 is a Tuesday (weekday 2).
    const tuesday = new Date("2026-08-04T09:00:00Z");
    expect(isExpectedOn([2], tuesday)).toBe(true);
    expect(isExpectedOn([0, 1], tuesday)).toBe(false);
  });

  it("uses the Riyadh day near the boundary, not the UTC one", () => {
    // 21:30 UTC on Monday is already Tuesday in Riyadh.
    const lateMonday = new Date("2026-08-03T21:30:00Z");
    expect(isExpectedOn([2], lateMonday)).toBe(true);
  });
});

describe("attendanceRatio", () => {
  it("counts only the days the child was expected", () => {
    // A part-time child enrolled three days a week has not missed anything by
    // being absent on the other two — this is the whole point of the feature.
    const result = attendanceRatio(
      [0, 1, 2],
      [new Date("2026-08-02T09:00:00Z"), new Date("2026-08-03T09:00:00Z")],
      new Date("2026-08-02T00:00:00Z"),
      new Date("2026-08-08T00:00:00Z")
    );
    expect(result.expected).toBe(3);
    expect(result.attended).toBe(2);
  });

  it("does not double-count two records on one day", () => {
    const result = attendanceRatio(
      [0],
      [new Date("2026-08-02T08:00:00Z"), new Date("2026-08-02T14:00:00Z")],
      new Date("2026-08-02T00:00:00Z"),
      new Date("2026-08-08T00:00:00Z")
    );
    expect(result.attended).toBe(1);
  });

  it("uses the default week when no schedule is set", () => {
    const result = attendanceRatio(
      [],
      [],
      new Date("2026-08-02T00:00:00Z"),
      new Date("2026-08-08T00:00:00Z")
    );
    expect(result.expected).toBe(5);
  });
});

describe("capacityState", () => {
  it("never warns when no capacity is configured", () => {
    // Turning an unset field into an implicit limit would light up warnings
    // across a school that never asked for them.
    const state = capacityState(40, null);
    expect(state.over).toBe(false);
    expect(state.remaining).toBeNull();
  });

  it("reports remaining places and only flags a genuine overflow", () => {
    expect(capacityState(18, 20).remaining).toBe(2);
    expect(capacityState(20, 20).over).toBe(false);
    expect(capacityState(21, 20).over).toBe(true);
  });

  it("treats zero as a closed room, not as unlimited", () => {
    expect(capacityState(1, 0).over).toBe(true);
  });
});

describe("ageGroupForMonths", () => {
  it("places infants in the narrow bands", () => {
    expect(ageGroupForMonths(3)).toBe("AGE_0_6M");
    expect(ageGroupForMonths(8)).toBe("AGE_6_12M");
    expect(ageGroupForMonths(18)).toBe("AGE_1_2Y");
  });

  it("uses exclusive upper bounds", () => {
    expect(ageGroupForMonths(6)).toBe("AGE_6_12M");
    expect(ageGroupForMonths(12)).toBe("AGE_1_2Y");
  });

  it("returns null above the top band rather than clamping", () => {
    // A five-year-old in a nursery is a fact worth surfacing, not rounding away.
    expect(ageGroupForMonths(60)).toBeNull();
  });
});

describe("monthsOld", () => {
  it("does not count a birthday that has not arrived", () => {
    expect(monthsOld(new Date("2025-08-20T00:00:00Z"), new Date("2026-08-04T00:00:00Z"))).toBe(11);
  });

  it("counts the month once the day is reached", () => {
    expect(monthsOld(new Date("2025-08-04T00:00:00Z"), new Date("2026-08-04T00:00:00Z"))).toBe(12);
  });
});
