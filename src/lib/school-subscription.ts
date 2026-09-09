export const SCHOOL_SUBSCRIPTION_GRACE_DAYS = 7;

export type SchoolSubscriptionType = "TRIAL" | "MONTHLY" | "YEARLY";
export type SchoolSubscriptionTypeOrUnassigned = SchoolSubscriptionType | "UNASSIGNED";

type SchoolSubscriptionRecord = {
  subscription_status: string;
  renewal_date: Date | null;
  createdAt?: Date;
  subscription_plan?: { billing_interval: "MONTHLY" | "YEARLY" | null } | null;
};

export type SchoolSubscriptionAccess = {
  mode: "active" | "grace" | "locked";
  reason: "active" | "expired" | "suspended" | "cancelled";
  renewalDate: string | null;
  daysOverdue: number;
  graceDaysRemaining: number;
  showFirstExpiredDayPopup: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateOnly(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/**
 * A renewal date is valid through its calendar day. The next calendar day is
 * grace day one; write access closes after seven full grace days.
 */
export function schoolSubscriptionRenewalDate(
  school: Pick<SchoolSubscriptionRecord, "subscription_status" | "renewal_date" | "createdAt">
): Date | null {
  if (school.renewal_date) return school.renewal_date;
  if (school.subscription_status === "trial" && school.createdAt) {
    return addSchoolBillingPeriod(school.createdAt, "MONTHLY");
  }
  return null;
}

export function schoolSubscriptionType(
  school: Pick<SchoolSubscriptionRecord, "subscription_status" | "subscription_plan">
): SchoolSubscriptionTypeOrUnassigned {
  const interval = school.subscription_plan?.billing_interval;
  if (interval === "MONTHLY" || interval === "YEARLY") return interval;
  if (school.subscription_status === "trial" || school.subscription_status === "expired") {
    return "TRIAL";
  }
  return "UNASSIGNED";
}

export function schoolSubscriptionAccess(
  school: Pick<SchoolSubscriptionRecord, "subscription_status" | "renewal_date" | "createdAt">,
  now = new Date()
): SchoolSubscriptionAccess {
  const effectiveRenewalDate = schoolSubscriptionRenewalDate(school);
  const renewalDate = effectiveRenewalDate?.toISOString() ?? null;

  if (school.subscription_status === "suspended" || school.subscription_status === "cancelled") {
    return {
      mode: "locked",
      reason: school.subscription_status === "cancelled" ? "cancelled" : "suspended",
      renewalDate,
      daysOverdue: 0,
      graceDaysRemaining: 0,
      showFirstExpiredDayPopup: false,
    };
  }

  if (!effectiveRenewalDate) {
    return school.subscription_status === "expired"
      ? { mode: "locked", reason: "expired", renewalDate: null, daysOverdue: 0, graceDaysRemaining: 0, showFirstExpiredDayPopup: false }
      : { mode: "active", reason: "active", renewalDate: null, daysOverdue: 0, graceDaysRemaining: 0, showFirstExpiredDayPopup: false };
  }

  const daysOverdue = Math.max(
    0,
    Math.floor((utcDateOnly(now) - utcDateOnly(effectiveRenewalDate)) / DAY_MS)
  );
  if (daysOverdue === 0) {
    return { mode: "active", reason: "active", renewalDate, daysOverdue: 0, graceDaysRemaining: 0, showFirstExpiredDayPopup: false };
  }
  if (daysOverdue <= SCHOOL_SUBSCRIPTION_GRACE_DAYS) {
    return {
      mode: "grace",
      reason: "expired",
      renewalDate,
      daysOverdue,
      graceDaysRemaining: SCHOOL_SUBSCRIPTION_GRACE_DAYS - daysOverdue + 1,
      showFirstExpiredDayPopup: daysOverdue === 1,
    };
  }
  return { mode: "locked", reason: "expired", renewalDate, daysOverdue, graceDaysRemaining: 0, showFirstExpiredDayPopup: false };
}

export function addSchoolBillingPeriod(base: Date, interval: "MONTHLY" | "YEARLY"): Date {
  const next = new Date(base);
  const day = next.getUTCDate();
  if (interval === "MONTHLY") {
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  } else {
    const month = next.getUTCMonth();
    next.setUTCDate(1);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    next.setUTCMonth(month);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), month + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next;
}

export function schoolPlanLabel(interval: "MONTHLY" | "YEARLY"): string {
  return interval === "MONTHLY" ? "شهري" : "سنوي";
}
