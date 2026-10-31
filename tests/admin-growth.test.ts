import { describe, expect, it } from "vitest";
import { forecastTrend, percentageChange } from "@/lib/admin-growth";

describe("growth forecast math", () => {
  it("keeps a stable series stable and marks sufficient history as high confidence", () => {
    expect(forecastTrend([4, 4, 4, 4, 4, 4], 3)).toEqual({
      values: [4, 4, 4],
      confidence: "HIGH",
    });
  });

  it("projects a rising trend without allowing an extreme one-month jump", () => {
    const forecast = forecastTrend([1, 2, 3, 4, 5, 20], 3);

    expect(forecast.values).toHaveLength(3);
    expect(forecast.values[0]).toBeGreaterThan(5);
    expect(forecast.values[0]).toBeLessThanOrEqual(20);
    expect(forecast.values[2]).toBeGreaterThanOrEqual(forecast.values[0]);
  });

  it("does not invent a percentage when the comparison period is zero", () => {
    expect(percentageChange(5, 0)).toBeNull();
    expect(percentageChange(0, 0)).toBe(0);
    expect(percentageChange(12, 10)).toBe(20);
  });
});
