import { describe, it, expect } from "vitest";
import { buildReportFields, describeReport, TYPE_FIELDS } from "@/lib/care-reports";

/**
 * Care report field handling (task 2.1).
 *
 * The rule under test: a report only ever carries the fields its own type owns.
 * Without it, changing a report from "meal" to "nap" leaves `mealAmount`
 * populated on a nap record — data that reads as real, is not, and that the
 * analytics layer would happily aggregate.
 */
describe("buildReportFields", () => {
  it("keeps the fields the type owns", () => {
    const fields = buildReportFields({
      studentId: "s1",
      type: "MEAL",
      mealName: "غداء",
      mealAmount: "HALF",
    });
    expect(fields?.mealName).toBe("غداء");
    expect(fields?.mealAmount).toBe("HALF");
  });

  it("blanks fields belonging to other types", () => {
    const fields = buildReportFields({
      studentId: "s1",
      type: "MEAL",
      mealName: "غداء",
      // Sent by a client that switched type without clearing its state.
      mood: "HAPPY",
      temperature: 38,
      medicationName: "باراسيتامول",
    });
    expect(fields?.mood).toBeNull();
    expect(fields?.temperature).toBeNull();
    expect(fields?.medicationName).toBeNull();
  });

  it("returns null when nothing was actually filled in", () => {
    // A tap that saves an empty record is worse than one that fails: the parent
    // sees a report that says nothing and assumes something was meant by it.
    expect(buildReportFields({ studentId: "s1", type: "MEAL" })).toBeNull();
    expect(buildReportFields({ studentId: "s1", type: "MEAL", note: "   " })).toBeNull();
  });

  it("accepts a note alone, even with no type-specific data", () => {
    expect(buildReportFields({ studentId: "s1", type: "GENERAL", note: "يوم جميل" })).not.toBeNull();
  });

  it("derives nap duration on the server", () => {
    const fields = buildReportFields({
      studentId: "s1",
      type: "NAP",
      napStartAt: "2026-08-04T09:00:00Z",
      napEndAt: "2026-08-04T10:30:00Z",
    });
    expect(fields?.napMinutes).toBe(90);
  });

  it("refuses a nap that ends before it starts", () => {
    const fields = buildReportFields({
      studentId: "s1",
      type: "NAP",
      napStartAt: "2026-08-04T10:30:00Z",
      napEndAt: "2026-08-04T09:00:00Z",
    });
    expect(fields?.napMinutes).toBeNull();
  });

  it("ignores an unparseable timestamp instead of storing Invalid Date", () => {
    const fields = buildReportFields({
      studentId: "s1",
      type: "NAP",
      napStartAt: "not a date",
      napEndAt: "2026-08-04T10:30:00Z",
      napQuality: "هادئ",
    });
    expect(fields?.napStartAt).toBeNull();
    expect(fields?.napMinutes).toBeNull();
  });
});

describe("TYPE_FIELDS", () => {
  it("gives every type a definition", () => {
    // A type missing from the map would have all its fields silently blanked.
    for (const type of Object.keys(TYPE_FIELDS)) {
      expect(TYPE_FIELDS[type as keyof typeof TYPE_FIELDS]).toBeDefined();
    }
  });
});

describe("describeReport", () => {
  it("summarises each type in one line", () => {
    expect(describeReport({ type: "MEAL", mealName: "غداء", mealAmount: "ALL" })).toContain("غداء");
    expect(describeReport({ type: "NAP", napMinutes: 45 })).toContain("45");
    expect(describeReport({ type: "MOOD", mood: "HAPPY" })).toBe("سعيد");
    expect(describeReport({ type: "HEALTH", temperature: 38.2 })).toContain("38.2");
  });

  it("falls back to the type name when the record is sparse", () => {
    expect(describeReport({ type: "MEAL" })).toBe("وجبة");
    expect(describeReport({ type: "TOILET" })).toBe("دورة مياه");
  });
});
