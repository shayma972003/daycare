import { calendarToday, storedDate, DAY_MS, deviceTimeZone } from "@/lib/device-date";

/** A subscription end date remains valid through the caller's calendar day. */
export function subscriptionExpired(enrollmentEndDate: Date | string | null | undefined, at: Date = new Date(), timeZone: string = deviceTimeZone()): boolean {
  if (!enrollmentEndDate) return false;
  return storedDate(enrollmentEndDate).getTime() < calendarToday(at, timeZone).getTime();
}

export function subscriptionExpiringSoon(end: Date | string | null | undefined, at = new Date(), zone = deviceTimeZone()): boolean {
  if (!end) return false;
  const days = (storedDate(end).getTime() - calendarToday(at, zone).getTime()) / DAY_MS;
  // The current day and the following seven calendar days are included.
  return days >= 0 && days <= 7;
}

export function subscriptionFilterWhere(filter: string | null, today: Date) {
  if (filter === "expired") return { enrollmentEndDate: { lt: today } };
  if (filter === "expiring") return { enrollmentEndDate: { gte: today, lt: new Date(today.getTime() + 8 * DAY_MS) } };
  if (filter === "current") return { OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: today } }] };
  return {};
}

/** A display state for the subscription, not a rewrite of historical payments. */
export function subscriptionPaymentStatus<T>(status: T, end: Date | string | null | undefined, at = new Date(), zone = deviceTimeZone()): T | "PENDING" {
  if (status === "CANCELLED" || status === "SUSPENDED") return status;
  return subscriptionExpired(end, at, zone) ? "PENDING" : status;
}

/** Operational roster membership, distinct from withdrawal and payment state. */
export function isOperationallyActive(student: { isActive: boolean; enrollmentEndDate?: Date | string | null }, at: Date = new Date()): boolean {
  return student.isActive && !subscriptionExpired(student.enrollmentEndDate, at);
}

/** Expiry alone never implies manual suspension or payment. */
export function renewalNeedsReactivation(student: { isActive: boolean; status?: string; paymentStatus?: string }): boolean {
  return !student.isActive || (student.status !== undefined && student.status !== "ACTIVE") ||
    student.paymentStatus === "CANCELLED" || student.paymentStatus === "SUSPENDED";
}

export function renewalErrorKey(code?: string): string {
  const keys: Record<string, string> = {
    REACTIVATION_REQUIRED: "students.renewalReactivationRequired",
    INVALID_RENEWAL_DATE: "students.renewalInvalidDate",
    RENEWAL_CANNOT_SHORTEN: "students.renewalCannotShorten",
    ACTIVE_TERMS_CHANGE: "students.renewalActiveTerms",
    CYCLE_FEE_REQUIRED: "students.renewalFeeRequired",
    BILLING_INTERVAL_REQUIRED: "students.renewalIntervalRequired",
    ANONYMIZED_STUDENT: "students.renewalAnonymized",
    NOT_FOUND: "students.renewalNotFound",
    INVALID_TIME_ZONE: "students.renewalTimeZoneInvalid",
  };
  return keys[code ?? ""] ?? "common.somethingWentWrong";
}
