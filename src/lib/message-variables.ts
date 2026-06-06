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

function toArabicDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("ar-SA", {
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

export function replaceMessageVariables(
  template: string,
  ctx: MessageContext
): string {
  const vars = buildMessageVars(ctx);
  return template.replace(/<(\w+)>/g, (match, key) => vars[key] ?? match);
}
