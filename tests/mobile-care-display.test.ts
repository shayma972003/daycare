import { describe, expect, it } from "vitest";

import {
  careReportSummary,
  careReportTypeLabel,
  type CareReportDisplay,
} from "../mobile/src/care-report-display";

function report(overrides: Partial<CareReportDisplay>): CareReportDisplay {
  return {
    type: "GENERAL",
    typeLabel: "عام",
    summary: "ملاحظة",
    note: null,
    mealSource: null,
    mealName: null,
    mealAmount: null,
    napMinutes: null,
    napQuality: null,
    toiletKind: null,
    toiletState: null,
    mood: null,
    medicationName: null,
    medicationDose: null,
    temperature: null,
    symptom: null,
    supplyItem: null,
    supplyQuantity: null,
    ...overrides,
  };
}

describe("mobile guardian care localization", () => {
  it("localizes every care-report heading without relying on an Arabic API label", () => {
    const expectations = {
      MEAL: "Meals",
      NAP: "Sleep and naps",
      TOILET: "Toilet and diaper",
      MOOD: "Mood",
      MEDICATION: "Medication",
      HEALTH: "General health",
      SUPPLIES: "Supply request",
      GENERAL: "General",
    } as const;

    for (const [type, label] of Object.entries(expectations)) {
      expect(careReportTypeLabel(report({ type: type as CareReportDisplay["type"] }), "en"))
        .toBe(label);
    }
  });

  it("localizes generated optional details while preserving teacher-entered text", () => {
    expect(careReportSummary(report({
      type: "HEALTH",
      temperature: 37.5,
      symptom: "Mild cough",
    }), "en")).toBe("Temperature 37.5°C — Mild cough");

    expect(careReportSummary(report({
      type: "MEAL",
      mealSource: "HOME",
      mealAmount: "HALF",
      note: "Preferred fruit",
    }), "en")).toBe("Meal from home — (Half) — Preferred fruit");

    expect(careReportSummary(report({
      type: "SUPPLIES",
      supplyItem: "Diapers",
      supplyQuantity: 2,
    }), "en")).toBe("Diapers × 2");
  });

  it("keeps the Arabic API wording unchanged in Arabic mode", () => {
    const value = report({ type: "HEALTH", typeLabel: "الصحة العامة", summary: "متابعة صحية" });
    expect(careReportTypeLabel(value, "ar")).toBe("الصحة العامة");
    expect(careReportSummary(value, "ar")).toBe("متابعة صحية");
  });
});
