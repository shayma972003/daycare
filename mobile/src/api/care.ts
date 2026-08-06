import { request } from "./client";

/**
 * Care reports, as the app files them.
 *
 * The eight types and their Arabic labels are duplicated from
 * `src/lib/care-reports.ts` on the server rather than fetched, because an app in
 * the wild cannot be updated on demand: a build from six months ago must still
 * render a list it understands. The *values* are the contract — the server
 * validates them — and adding a ninth type means shipping an app update, which
 * is true of any native client.
 */
export const CARE_TYPES = [
  { value: "MEAL", label: "وجبة" },
  { value: "NAP", label: "نوم" },
  { value: "TOILET", label: "دورة المياه" },
  { value: "MOOD", label: "الحالة المزاجية" },
  { value: "MEDICATION", label: "دواء" },
  { value: "HEALTH", label: "صحة" },
  { value: "SUPPLIES", label: "مستلزمات" },
  { value: "GENERAL", label: "عام" },
] as const;

export type CareType = (typeof CARE_TYPES)[number]["value"];

export const MEAL_AMOUNTS = [
  { value: "ALL", label: "الكل" },
  { value: "HALF", label: "نصف" },
  { value: "LITTLE", label: "قليل" },
  { value: "REFUSED", label: "رفض" },
] as const;

export const MOODS = [
  { value: "HAPPY", label: "سعيد" },
  { value: "CALM", label: "هادئ" },
  { value: "TIRED", label: "متعب" },
  { value: "UPSET", label: "منزعج" },
  { value: "CRYING", label: "يبكي" },
  { value: "UNWELL", label: "متوعّك" },
] as const;

export const TOILET_KINDS = [
  { value: "DIAPER", label: "حفاض" },
  { value: "POTTY", label: "حمّام" },
] as const;

/**
 * What a report may carry.
 *
 * Only the fields the chosen type owns are sent; the server blanks the rest
 * anyway (`TYPE_FIELDS`), and sending a nap duration on a meal report would be
 * data that reads as real and is not.
 */
export interface CareReportInput {
  type: CareType;
  mealName?: string | null;
  mealAmount?: string | null;
  napQuality?: string | null;
  toiletKind?: string | null;
  toiletState?: string | null;
  mood?: string | null;
  medicationName?: string | null;
  medicationDose?: string | null;
  temperature?: number | null;
  symptom?: string | null;
  supplyItem?: string | null;
  note?: string | null;
}

export async function fileCareReport(
  studentIds: string[],
  report: CareReportInput
): Promise<number> {
  const data = await request<{ created: number }>("/api/mobile/v1/care-reports/create", {
    method: "POST",
    body: { studentIds, report },
  });
  return data.created;
}
