import { formatAst } from "@/lib/datetime";

export interface MessageContext {
  student?: {
    name?: string | null;
    registration_fee?: number | null;
    enrollmentEndDate?: Date | string | null;
  };
  guardian?: {
    name?: string | null;
    name_2?: string | null;
  };
  school?: {
    name?: string | null;
    studentCheckinTime?: string | null;
    studentCheckoutTime?: string | null;
  };
  activity?: {
    name?: string | null;
    activityFee?: number | null;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
  };
}

/**
 * Date for a message body.
 *
 * `toLocaleDateString("ar-SA")` resolves to the Gregorian calendar, so this was
 * not sending Hijri dates — but it was wrong twice over:
 *
 * - **No time zone.** It used the host's, which on Vercel is UTC. A reminder
 *   generated after 21:00 Riyadh time quoted the previous day as the due date.
 * - **Arabic-Indic numerals.** "٠٣/٠٨/٢٠٢٦" in the message against "03/08/2026"
 *   on screen — the same date, looking like two.
 *
 * Routed through `formatAst`, the single definition of how this product writes
 * a date.
 */
function toArabicDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  return formatAst(new Date(value), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function buildMessageVars(ctx: MessageContext): Record<string, string> {
  return {
    child_name: ctx.student?.name ?? "",
    guardian_name: ctx.guardian?.name ?? "",
    guardian_2_name: ctx.guardian?.name_2 ?? "",
    checkin_time: ctx.school?.studentCheckinTime ?? "",
    checkout_time: ctx.school?.studentCheckoutTime ?? "",
    subscription_fee:
      ctx.student?.registration_fee != null
        ? `${ctx.student.registration_fee} ر.س`
        : "",
    activity_fee:
      ctx.activity?.activityFee != null
        ? `${ctx.activity.activityFee} ر.س`
        : "",
    due_date: toArabicDate(ctx.student?.enrollmentEndDate),
    activity_date:
      ctx.activity?.startDate && ctx.activity?.endDate
        ? `من ${toArabicDate(ctx.activity.startDate)} إلى ${toArabicDate(ctx.activity.endDate)}`
        : "",
    school_name: ctx.school?.name ?? "",
    activity_name: ctx.activity?.name ?? "",
    // Legacy alias kept for backward compat with old templates
    amount_due:
      ctx.student?.registration_fee != null
        ? `${ctx.student.registration_fee} ر.س`
        : "",
  };
}
