export const SCHOOL_SUBSCRIPTION_GRACE_DAYS = 7;

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
export function schoolSubscriptionAccess(
  school: { subscription_status: string; renewal_date: Date | null },
  now = new Date()
): SchoolSubscriptionAccess {
  const renewalDate = school.renewal_date?.toISOString() ?? null;

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

  if (!school.renewal_date) {
    return school.subscription_status === "expired"
      ? { mode: "locked", reason: "expired", renewalDate: null, daysOverdue: 0, graceDaysRemaining: 0, showFirstExpiredDayPopup: false }
      : { mode: "active", reason: "active", renewalDate: null, daysOverdue: 0, graceDaysRemaining: 0, showFirstExpiredDayPopup: false };
  }

  const daysOverdue = Math.max(
    0,
    Math.floor((utcDateOnly(now) - utcDateOnly(school.renewal_date)) / DAY_MS)
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
