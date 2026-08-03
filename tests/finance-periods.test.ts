import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

/**
 * Reporting periods (task 0.54).
 *
 * `getPreviousPeriodRange` has already been wrong once, and it was wrong in a
 * way nobody could see: the growth percentages on the dashboard were computed
 * against the wrong window and still looked like plausible numbers. Annual
 * compared against two years back, monthly against a two-day sliver of the wrong
 * month, and the first half of the year against the previous year's first half.
 *
 * The cause was reading calendar components off an AST-shifted instant with
 * `getUTC*` — 21:00 on the previous day. These tests pin the boundaries in AST
 * terms so the same class of mistake cannot return silently.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-characters-long!";
  process.env.NEXTAUTH_URL ??= "http://localhost:3000";
  process.env.ADMIN_JWT_SECRET ??= "test-admin-secret-at-least-32-chars!!";
});

afterEach(() => {
  vi.useRealTimers();
});

/** The Riyadh wall clock at an instant, which is what a boundary means here. */
function ast(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().replace("Z", "+03:00");
}

/** Pretends "now" is a given Riyadh wall-clock moment. */
function atRiyadh(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}+03:00`));
}

describe("getPeriodRange", () => {
  it("monthly covers the calendar month in Riyadh terms", async () => {
    const { getPeriodRange } = await import("@/lib/finance");
    atRiyadh("2026-08-03T14:00:00");

    const range = getPeriodRange("monthly");

    expect(ast(range.from)).toBe("2026-08-01T00:00:00.000+03:00");
    expect(ast(range.to)).toBe("2026-08-31T23:59:59.999+03:00");
  });

  it("monthly ends on the right day in a leap February", async () => {
    const { getPeriodRange } = await import("@/lib/finance");
    atRiyadh("2028-02-10T09:00:00");

    expect(ast(getPeriodRange("monthly").to)).toBe("2028-02-29T23:59:59.999+03:00");
  });

  it("uses the Riyadh date late at night, not the host's UTC date", async () => {
    const { getPeriodRange } = await import("@/lib/finance");
    // 00:30 on 1 September in Riyadh is still 31 August in UTC. Reading the host
    // clock would put this in August's period.
    atRiyadh("2026-09-01T00:30:00");

    expect(ast(getPeriodRange("monthly").from)).toBe("2026-09-01T00:00:00.000+03:00");
  });

  it("semi-annual is a fixed calendar half, not a rolling six months", async () => {
    const { getPeriodRange } = await import("@/lib/finance");

    atRiyadh("2026-03-15T12:00:00");
    const h1 = getPeriodRange("semi_annual");
    expect(ast(h1.from)).toBe("2026-01-01T00:00:00.000+03:00");
    expect(ast(h1.to)).toBe("2026-06-30T23:59:59.999+03:00");

    atRiyadh("2026-11-20T12:00:00");
    const h2 = getPeriodRange("semi_annual");
    expect(ast(h2.from)).toBe("2026-07-01T00:00:00.000+03:00");
    expect(ast(h2.to)).toBe("2026-12-31T23:59:59.999+03:00");
  });

  it("annual covers the calendar year", async () => {
    const { getPeriodRange } = await import("@/lib/finance");
    atRiyadh("2026-08-03T14:00:00");

    const range = getPeriodRange("annual");
    expect(ast(range.from)).toBe("2026-01-01T00:00:00.000+03:00");
    expect(ast(range.to)).toBe("2026-12-31T23:59:59.999+03:00");
  });
});

describe("getPreviousPeriodRange", () => {
  it("monthly is the whole previous month, not a sliver of it", async () => {
    const { getPeriodRange, getPreviousPeriodRange } = await import("@/lib/finance");
    atRiyadh("2026-07-15T10:00:00");

    const previous = getPreviousPeriodRange("monthly", getPeriodRange("monthly"));

    expect(ast(previous.from)).toBe("2026-06-01T00:00:00.000+03:00");
    expect(ast(previous.to)).toBe("2026-06-30T23:59:59.999+03:00");
  });

  it("monthly crosses the year boundary", async () => {
    const { getPeriodRange, getPreviousPeriodRange } = await import("@/lib/finance");
    atRiyadh("2026-01-10T10:00:00");

    const previous = getPreviousPeriodRange("monthly", getPeriodRange("monthly"));

    expect(ast(previous.from)).toBe("2025-12-01T00:00:00.000+03:00");
    expect(ast(previous.to)).toBe("2025-12-31T23:59:59.999+03:00");
  });

  it("annual is one year back, not two", async () => {
    const { getPeriodRange, getPreviousPeriodRange } = await import("@/lib/finance");
    atRiyadh("2026-08-03T14:00:00");

    const previous = getPreviousPeriodRange("annual", getPeriodRange("annual"));

    expect(ast(previous.from)).toBe("2025-01-01T00:00:00.000+03:00");
    expect(ast(previous.to)).toBe("2025-12-31T23:59:59.999+03:00");
  });

  it("compares H1 against the previous year's H2, and H2 against the same year's H1", async () => {
    const { getPeriodRange, getPreviousPeriodRange } = await import("@/lib/finance");

    atRiyadh("2026-03-15T12:00:00");
    const beforeH1 = getPreviousPeriodRange("semi_annual", getPeriodRange("semi_annual"));
    expect(ast(beforeH1.from)).toBe("2025-07-01T00:00:00.000+03:00");
    expect(ast(beforeH1.to)).toBe("2025-12-31T23:59:59.999+03:00");

    atRiyadh("2026-11-20T12:00:00");
    const beforeH2 = getPreviousPeriodRange("semi_annual", getPeriodRange("semi_annual"));
    expect(ast(beforeH2.from)).toBe("2026-01-01T00:00:00.000+03:00");
    expect(ast(beforeH2.to)).toBe("2026-06-30T23:59:59.999+03:00");
  });

  it("produces a previous period that never overlaps the current one", async () => {
    const { getPeriodRange, getPreviousPeriodRange } = await import("@/lib/finance");

    for (const type of ["monthly", "semi_annual", "annual"] as const) {
      for (const now of ["2026-01-01T00:05:00", "2026-06-30T23:00:00", "2026-12-31T22:00:00"]) {
        atRiyadh(now);
        const current = getPeriodRange(type);
        const previous = getPreviousPeriodRange(type, current);

        expect(previous.to.getTime()).toBeLessThan(current.from.getTime());
      }
    }
  });
});
