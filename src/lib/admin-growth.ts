export type ForecastConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface TrendForecast {
  values: number[];
  confidence: ForecastConfidence;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * Small, explainable trend projection for the super-admin dashboard.
 * It intentionally avoids presenting a statistical model as certainty:
 * only the last six complete months are used, the slope is damped, and any
 * single-step movement is capped so one unusual month cannot explode the
 * projection.
 */
export function forecastTrend(
  history: number[],
  horizon = 3,
  precision = 0,
): TrendForecast {
  const observed = history.slice(-6).map((value) => Math.max(0, Number(value) || 0));
  if (observed.length === 0) {
    return { values: Array.from({ length: horizon }, () => 0), confidence: "LOW" };
  }

  const n = observed.length;
  const meanX = (n - 1) / 2;
  const meanY = observed.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let variance = 0;
  observed.forEach((value, index) => {
    covariance += (index - meanX) * (value - meanY);
    variance += (index - meanX) ** 2;
  });
  const rawSlope = variance === 0 ? 0 : covariance / variance;
  const recent = observed.slice(-3);
  const weightTotal = recent.reduce((sum, _value, index) => sum + index + 1, 0);
  const baseline = recent.reduce((sum, value, index) => sum + value * (index + 1), 0) / weightTotal;
  const maximumStep = Math.max(baseline * 0.5, precision === 0 ? 1 : 100);
  const slope = Math.max(-maximumStep, Math.min(maximumStep, rawSlope * 0.5));
  const values = Array.from({ length: horizon }, (_value, index) => (
    round(Math.max(0, baseline + slope * (index + 1)), precision)
  ));

  const nonZeroMonths = observed.filter((value) => value > 0).length;
  const confidence: ForecastConfidence = n >= 6 && nonZeroMonths >= 4
    ? "HIGH"
    : n >= 4 && nonZeroMonths >= 2
      ? "MEDIUM"
      : "LOW";

  return { values, confidence };
}

export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}
