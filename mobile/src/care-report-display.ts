type AppLanguage = "ar" | "en";

export type CareReportDisplay = {
  type: "MEAL" | "NAP" | "TOILET" | "MOOD" | "MEDICATION" | "HEALTH" | "SUPPLIES" | "GENERAL";
  typeLabel: string;
  summary: string;
  note: string | null;
  mealSource: "CENTER" | "HOME" | null;
  mealName: string | null;
  mealAmount: "ALL" | "HALF" | "LITTLE" | "REFUSED" | null;
  napMinutes: number | null;
  napQuality: string | null;
  toiletKind: "DIAPER" | "POTTY" | null;
  toiletState: string | null;
  mood: "HAPPY" | "CALM" | "TIRED" | "UPSET" | "CRYING" | "UNWELL" | null;
  medicationName: string | null;
  medicationDose: string | null;
  temperature: number | null;
  symptom: string | null;
  supplyItem: string | null;
  supplyQuantity: number | null;
};

type CareReportType = CareReportDisplay["type"];

const ENGLISH_TYPE_LABELS: Record<CareReportType, string> = {
  MEAL: "Meals",
  NAP: "Sleep and naps",
  TOILET: "Toilet and diaper",
  MOOD: "Mood",
  MEDICATION: "Medication",
  HEALTH: "General health",
  SUPPLIES: "Supply request",
  GENERAL: "General",
};

const ENGLISH_MEAL_AMOUNTS: Record<NonNullable<CareReportDisplay["mealAmount"]>, string> = {
  ALL: "All",
  HALF: "Half",
  LITTLE: "A little",
  REFUSED: "Refused",
};

const ENGLISH_MOODS: Record<NonNullable<CareReportDisplay["mood"]>, string> = {
  HAPPY: "Happy",
  CALM: "Calm",
  TIRED: "Tired",
  UPSET: "Upset",
  CRYING: "Crying",
  UNWELL: "Unwell",
};

export function careReportTypeLabel(
  report: Pick<CareReportDisplay, "type" | "typeLabel">,
  language: AppLanguage
): string {
  return language === "en" ? ENGLISH_TYPE_LABELS[report.type] : report.typeLabel;
}

/**
 * Builds the system-generated summary in the reader's language.
 * Free-text fields such as the meal name, symptom, and teacher note remain
 * exactly as entered instead of being sent to a translation service.
 */
export function careReportSummary(
  report: CareReportDisplay,
  language: AppLanguage
): string {
  if (language === "ar") return report.summary;

  switch (report.type) {
    case "MEAL":
      return [
        report.mealSource === "HOME" ? "Meal from home" : report.mealName,
        report.mealAmount ? `(${ENGLISH_MEAL_AMOUNTS[report.mealAmount]})` : null,
        report.note,
      ].filter(Boolean).join(" — ") || "Meal";
    case "NAP":
      if (report.napQuality === "DID_NOT_SLEEP") return "Did not sleep";
      return [
        report.napMinutes ? `Slept for ${report.napMinutes} minutes` : "Sleep",
        report.note,
      ].filter(Boolean).join(" — ");
    case "TOILET":
      return [
        report.toiletKind === "DIAPER"
          ? "Diaper"
          : report.toiletKind === "POTTY"
            ? "Toilet"
            : null,
        report.toiletState === "WET"
          ? "Wet"
          : report.toiletState === "SOILED"
            ? "Soiled"
            : report.toiletState,
        report.note,
      ].filter(Boolean).join(" — ") || "Toilet";
    case "MOOD":
      return report.mood ? ENGLISH_MOODS[report.mood] : "Mood";
    case "MEDICATION":
      return [report.medicationName, report.medicationDose]
        .filter(Boolean)
        .join(" — ") || "Medication";
    case "HEALTH":
      return [
        report.temperature ? `Temperature ${report.temperature}°C` : null,
        report.symptom,
      ].filter(Boolean).join(" — ") || "Health follow-up";
    case "SUPPLIES":
      return [
        report.supplyItem,
        report.supplyQuantity ? `× ${report.supplyQuantity}` : null,
      ].filter(Boolean).join(" ") || "Supply request";
    case "GENERAL":
      return report.note?.slice(0, 80) ?? "Note";
  }

  return report.summary;
}
