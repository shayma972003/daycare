/**
 * The eight daily-care report types, their fields, and their Arabic wording.
 *
 * One definition shared by the API validator, the teacher's form, the child's
 * profile view and the emailed digest. Written four times it would drift four
 * ways — a field the form collects and the validator drops is the kind of bug
 * that only shows up as "the note I typed disappeared".
 */

import { z } from "zod";
import type {
  CareReportType,
  MealAmount,
  ToiletKind,
  ChildMood,
  SupplyUrgency,
} from "@/generated/prisma/enums";

export const CARE_REPORT_TYPES: CareReportType[] = [
  "MEAL",
  "NAP",
  "TOILET",
  "MOOD",
  "MEDICATION",
  "HEALTH",
  "SUPPLIES",
  "GENERAL",
];

export const CARE_TYPE_LABELS: Record<CareReportType, string> = {
  MEAL: "وجبات الطعام",
  NAP: "النوم والغفوات",
  TOILET: "دورة المياه والحفاض",
  MOOD: "الحالة المزاجية",
  MEDICATION: "الدواء",
  HEALTH: "الصحة العامة",
  SUPPLIES: "طلب مستلزمات",
  GENERAL: "عام",
};

/**
 * The same eight, as dictionary keys.
 *
 * Both tables exist because they have different jobs. The resolved Arabic above
 * is what goes into a WhatsApp message and an activity-log entry — those are
 * written for the guardian and the audit trail, not for whoever has the
 * interface open. Anything a component renders reads these keys instead, so it
 * follows the reader's language.
 */
export const CARE_TYPE_LABEL_KEYS: Record<CareReportType, string> = {
  MEAL: "careTypes.MEAL",
  NAP: "careTypes.NAP",
  TOILET: "careTypes.TOILET",
  MOOD: "careTypes.MOOD",
  MEDICATION: "careTypes.MEDICATION",
  HEALTH: "careTypes.HEALTH",
  SUPPLIES: "careTypes.SUPPLIES",
  GENERAL: "careTypes.GENERAL",
};

/**
 * Accent colour per type, as literal Tailwind classes.
 *
 * The icons themselves are SVG components — see `CARE_TYPE_ICON_NAMES` in
 * src/components/ui/Icon.tsx. Emoji were used here first and replaced under task
 * 2.40: they are drawn by the operating system, so 🚼 and 💊 render as flat
 * monochrome boxes on the older Android phones most nursery staff carry, and
 * they cannot take a colour.
 *
 * Written out in full rather than built by interpolation — Tailwind scans source
 * text for complete class names, and a constructed one never reaches the
 * stylesheet.
 */
export const CARE_TYPE_COLORS: Record<CareReportType, string> = {
  MEAL: "text-[#C45000]",
  NAP: "text-[#7C3AED]",
  TOILET: "text-[#2F96A6]",
  MOOD: "text-[#F8B500]",
  MEDICATION: "text-[#C0232C]",
  HEALTH: "text-[#2D7A4F]",
  SUPPLIES: "text-[#8a5a00]",
  GENERAL: "text-gray-500",
};

export const MEAL_AMOUNT_LABELS: Record<MealAmount, string> = {
  ALL: "الكل",
  HALF: "نصف",
  LITTLE: "قليل",
  REFUSED: "رفض",
};

export const TOILET_KIND_LABELS: Record<ToiletKind, string> = {
  DIAPER: "حفاض",
  POTTY: "حمّام",
};

export const MOOD_LABELS: Record<ChildMood, string> = {
  HAPPY: "سعيد",
  CALM: "هادئ",
  TIRED: "متعب",
  UPSET: "منزعج",
  CRYING: "يبكي",
  UNWELL: "متوعّك",
};

export const SUPPLY_URGENCY_LABELS: Record<SupplyUrgency, string> = {
  NORMAL: "عادي",
  SOON: "قريباً",
  URGENT: "عاجل",
};

export const MEAL_AMOUNT_LABEL_KEYS: Record<MealAmount, string> = {
  ALL: "mealAmount.ALL",
  HALF: "mealAmount.HALF",
  LITTLE: "mealAmount.LITTLE",
  REFUSED: "mealAmount.REFUSED",
};

export const TOILET_KIND_LABEL_KEYS: Record<ToiletKind, string> = {
  DIAPER: "toiletKind.DIAPER",
  POTTY: "toiletKind.POTTY",
};

export const MOOD_LABEL_KEYS: Record<ChildMood, string> = {
  HAPPY: "mood.HAPPY",
  CALM: "mood.CALM",
  TIRED: "mood.TIRED",
  UPSET: "mood.UPSET",
  CRYING: "mood.CRYING",
  UNWELL: "mood.UNWELL",
};

export const SUPPLY_URGENCY_LABEL_KEYS: Record<SupplyUrgency, string> = {
  NORMAL: "supplyUrgency.NORMAL",
  SOON: "supplyUrgency.SOON",
  URGENT: "supplyUrgency.URGENT",
};

/**
 * Which columns each type is allowed to write.
 *
 * Used to blank everything else on save. Without it, editing a report from
 * "meal" to "nap" would leave `mealAmount` populated on a nap record — data that
 * reads as real and is not, and that the future analytics layer would happily
 * aggregate.
 */
export const TYPE_FIELDS: Record<CareReportType, readonly string[]> = {
  MEAL: ["mealName", "mealAmount"],
  NAP: ["napStartAt", "napEndAt", "napMinutes", "napQuality"],
  TOILET: ["toiletKind", "toiletState"],
  MOOD: ["mood"],
  MEDICATION: ["medicationName", "medicationDose", "givenByName"],
  HEALTH: ["temperature", "symptom", "actionTaken"],
  SUPPLIES: ["supplyItem", "supplyQuantity", "supplyUrgency"],
  GENERAL: [],
};

/** Every per-type column, used to null out the ones this type does not own. */
export const ALL_TYPE_FIELDS = Array.from(
  new Set(Object.values(TYPE_FIELDS).flat())
);

/**
 * Types carrying health data.
 *
 * A special category under PDPL, and the reason the accountant role has no
 * `students.files`: knowing who is billable does not require knowing what a
 * child is allergic to.
 */
export const SENSITIVE_TYPES: CareReportType[] = ["MEDICATION", "HEALTH"];

export const careReportInputSchema = z.object({
  studentId: z.string().min(1),
  type: z.enum(CARE_REPORT_TYPES as [CareReportType, ...CareReportType[]]),
  /** Defaults to now when the form does not ask. */
  occurredAt: z.string().optional(),

  mealName: z.string().max(120).nullish(),
  mealAmount: z.enum(["ALL", "HALF", "LITTLE", "REFUSED"]).nullish(),

  napStartAt: z.string().nullish(),
  napEndAt: z.string().nullish(),
  napQuality: z.string().max(120).nullish(),

  toiletKind: z.enum(["DIAPER", "POTTY"]).nullish(),
  toiletState: z.string().max(120).nullish(),

  mood: z.enum(["HAPPY", "CALM", "TIRED", "UPSET", "CRYING", "UNWELL"]).nullish(),

  medicationName: z.string().max(120).nullish(),
  medicationDose: z.string().max(120).nullish(),
  givenByName: z.string().max(120).nullish(),

  // Bounded to a range a human body can occupy. An unbounded float here means a
  // typo becomes a 356° reading in the parent's summary.
  temperature: z.number().min(30).max(45).nullish(),
  symptom: z.string().max(300).nullish(),
  actionTaken: z.string().max(300).nullish(),

  supplyItem: z.string().max(120).nullish(),
  supplyQuantity: z.number().int().min(1).max(999).nullish(),
  supplyUrgency: z.enum(["NORMAL", "SOON", "URGENT"]).nullish(),

  note: z.string().max(1000).nullish(),
  photoUrl: z.string().nullish(),
});

export type CareReportInput = z.infer<typeof careReportInputSchema>;

/**
 * Builds the column values for one report, blanking every field the type does
 * not own.
 *
 * Returns `null` when the payload carries nothing at all — a tap that saves an
 * empty record is worse than one that fails, because the parent sees a report
 * that says nothing and assumes something was meant by it.
 */
export function buildReportFields(
  input: CareReportInput
): Record<string, unknown> | null {
  const allowed = new Set(TYPE_FIELDS[input.type]);
  const fields: Record<string, unknown> = {};

  for (const key of ALL_TYPE_FIELDS) {
    fields[key] = null;
  }

  const set = (key: string, value: unknown) => {
    if (allowed.has(key) && value !== undefined && value !== null && value !== "") {
      fields[key] = value;
    }
  };

  set("mealName", input.mealName);
  set("mealAmount", input.mealAmount);
  set("napQuality", input.napQuality);
  set("toiletKind", input.toiletKind);
  set("toiletState", input.toiletState);
  set("mood", input.mood);
  set("medicationName", input.medicationName);
  set("medicationDose", input.medicationDose);
  set("givenByName", input.givenByName);
  set("temperature", input.temperature);
  set("symptom", input.symptom);
  set("actionTaken", input.actionTaken);
  set("supplyItem", input.supplyItem);
  set("supplyQuantity", input.supplyQuantity);
  set("supplyUrgency", input.supplyUrgency);

  if (input.type === "NAP") {
    const start = input.napStartAt ? new Date(input.napStartAt) : null;
    const end = input.napEndAt ? new Date(input.napEndAt) : null;
    const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
    const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;

    fields.napStartAt = validStart;
    fields.napEndAt = validEnd;
    // Derived server-side, never taken from the client: the duration is the
    // figure the analytics layer will aggregate, and it must match the two
    // timestamps stored beside it.
    fields.napMinutes =
      validStart && validEnd && validEnd > validStart
        ? Math.round((validEnd.getTime() - validStart.getTime()) / 60000)
        : null;
  }

  const hasTypeData = TYPE_FIELDS[input.type].some(
    (key) => fields[key] !== null && fields[key] !== undefined
  );
  const hasCommon = Boolean(input.note?.trim() || input.photoUrl);

  if (!hasTypeData && !hasCommon) return null;

  return fields;
}

/** One-line rendering, used by the daily digest and the child's feed. */
export function describeReport(report: {
  type: CareReportType;
  mealName?: string | null;
  mealAmount?: MealAmount | null;
  napMinutes?: number | null;
  toiletKind?: ToiletKind | null;
  toiletState?: string | null;
  mood?: ChildMood | null;
  medicationName?: string | null;
  medicationDose?: string | null;
  temperature?: number | null;
  symptom?: string | null;
  supplyItem?: string | null;
  supplyQuantity?: number | null;
  note?: string | null;
}): string {
  switch (report.type) {
    case "MEAL":
      return [
        report.mealName,
        report.mealAmount ? `(${MEAL_AMOUNT_LABELS[report.mealAmount]})` : null,
      ]
        .filter(Boolean)
        .join(" ") || "وجبة";
    case "NAP":
      return report.napMinutes ? `نوم ${report.napMinutes} دقيقة` : "نوم";
    case "TOILET":
      return [
        report.toiletKind ? TOILET_KIND_LABELS[report.toiletKind] : null,
        report.toiletState,
      ]
        .filter(Boolean)
        .join(" — ") || "دورة مياه";
    case "MOOD":
      return report.mood ? MOOD_LABELS[report.mood] : "الحالة المزاجية";
    case "MEDICATION":
      return [report.medicationName, report.medicationDose]
        .filter(Boolean)
        .join(" — ") || "دواء";
    case "HEALTH":
      return [
        report.temperature ? `الحرارة ${report.temperature}°` : null,
        report.symptom,
      ]
        .filter(Boolean)
        .join(" — ") || "متابعة صحية";
    case "SUPPLIES":
      return [report.supplyItem, report.supplyQuantity ? `× ${report.supplyQuantity}` : null]
        .filter(Boolean)
        .join(" ") || "طلب مستلزمات";
    case "GENERAL":
      return report.note?.slice(0, 80) ?? "ملاحظة";
  }
}
