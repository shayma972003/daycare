import { describe, expect, it } from "vitest";

import { distanceMeters, roundedDistanceMeters } from "@/lib/teacher-location-attendance";

describe("teacher location attendance distance", () => {
  it("returns zero for the same point", () => {
    expect(distanceMeters(
      { latitude: 24.7136, longitude: 46.6753 },
      { latitude: 24.7136, longitude: 46.6753 }
    )).toBe(0);
  });

  it("calculates a realistic great-circle distance", () => {
    const distance = roundedDistanceMeters(
      { latitude: 24.7136, longitude: 46.6753 },
      { latitude: 24.7145, longitude: 46.6753 }
    );
    expect(distance).toBeGreaterThanOrEqual(99);
    expect(distance).toBeLessThanOrEqual(101);
  });
});
